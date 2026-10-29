import { createHash, randomBytes } from 'node:crypto';
import { db, type DbOrTx } from '@/db/client';
import type { Album, AgentJob } from '@/db/schema';
import { albumRepo } from '@/db/repos/album-repo';
import { albumMemberRepo } from '@/db/repos/album-member-repo';
import { albumEditLinkRepo } from '@/db/repos/album-edit-link-repo';
import { draftPageRepo } from '@/db/repos/draft-page-repo';
import { albumPhotoRepo } from '@/db/repos/album-photo-repo';
import { agentJobRepo } from '@/db/repos/agent-job-repo';
import { userRepo } from '@/db/repos/user-repo';
import { ERRORS } from '@/lib/api/error-codes';
import { logger } from '@/lib/log/logger';
import { COLLAB_ERRORS } from './collaboration-errors';

// 能力模型迁往共享纯模块(collab rework Phase 5):lib/collaboration/capabilities.ts
// 是产品授权唯一真相,服务端(锁内检查)与前端(入口显隐)消费同一份定义。此处
// re-export 保持既有引用路径稳定。
export {
  albumCapabilities,
  CREATOR_CAPABILITIES,
  OWNER_ONLY_CAPABILITIES,
  capabilitiesForRole,
  type CreatorCapability,
  type OwnerCapability,
  type AlbumCapability,
  type AlbumCapabilities,
} from '@/lib/collaboration/capabilities';
import type { AlbumRole as SharedAlbumRole } from '@/lib/collaboration/capabilities';

// 协同模块(collab plan §5):成员授权 + 编辑链接的唯一服务边界。
//
// 产品模型(2026-08-28 更新):owner 与 editor 都是「Creator」,拥有完全相同的
// 手动/AI 创作权;owner 只额外拥有成员管理、编辑邀请、删除相册、转移所有权等
// 治理权。AI 是代表 actor 执行,不是独立角色。授权因此只有两级:
//   - requireAccess / requireCreator(owner|editor)= 创作 seam,所有作者读写路径
//     必须穿过它;
//   - requireOwner = 治理 seam,仅 owner。
// 本模块只依赖 repo,不反向依赖 albumService —— 依赖方向始终 album/* →
// collaboration/*。
export type AlbumRole = SharedAlbumRole;
export type AlbumAccess = { album: Album; role: AlbumRole };

// ── 邀请就绪门槛(collab plan §12.3/§13/§7.1)────────────────────────────────
// 纯函数:给定相册形态、最新持久化 job 与照片台账,判定能否创建编辑链接。
export type InvitationReadiness =
  | { ready: true }
  | { ready: false; reason: 'unsupported-album' | 'layout' | 'compose' | 'photos' };

export function invitationReadiness(input: {
  album: Pick<Album, 'layoutJson'>;
  draftPageCount: number;
  latestJob: Pick<AgentJob, 'status' | 'kind'> | null;
  referencedPhotoIds: string[];
  uploadedPhotoIds: string[];
}): InvitationReadiness {
  // V3 draft 形态:未定稿 + draft_pages 已播种 ≥1 行(协同写路径的唯一真相)。
  if (input.album.layoutJson !== null || input.draftPageCount < 1) {
    return { ready: false, reason: 'unsupported-album' };
  }
  // 在途的持久化生成任务:完成回调会整批回写页面,邀请必须等它们终态
  // (§7.1「创建邀请前确认没有 layout/compose 等在途 job」)。add 同理 ——
  // 追加照片也会整批落页。
  const job = input.latestJob;
  if (job && (job.status === 'QUEUED' || job.status === 'RUNNING')) {
    if (job.kind === 'layout' || job.kind === 'add') return { ready: false, reason: 'layout' };
    if (job.kind === 'compose') return { ready: false, reason: 'compose' };
  }
  // 照片可用性(§13):editor 读图只走服务器。本仓没有服务端 renderVersion
  // 概念,快照兜底无法判「当前有效」,故取严格口径 —— 引用的照片必须全部
  // uploaded,缺一张都拒绝,防止「能进编辑器但大量空图」。
  const uploaded = new Set(input.uploadedPhotoIds);
  const missing = input.referencedPhotoIds.some((id) => !uploaded.has(id));
  if (missing) return { ready: false, reason: 'photos' };
  return { ready: true };
}

// 单次增量返回的页数上限(collab plan §7.4):超过即 reloadRequired,牺牲流量
// 换可靠性,避免一次响应携带整本书。
export const DRAFT_CHANGES_MAX_PAGES = 300;

// ── AI 长任务基线(collab rework §Phase 4)──────────────────────────────────
// AI 是「带着旧快照迟到的写者」:job 启动时记录基线,完成回写前在相册行锁内
// 重验 —— 失配即 AI_RESULT_STALE,零写入,人工编辑优先。只覆盖异步 job 的
// 回写(layout/compose);同步锁内路径(design-chat 等)读改写同一锁,天然安全。
export type JobBaseline = {
  structureRevision: number;
  settingsRevision: number;
  // 启动时 draft_pages 的版本快照。空数组 = 启动时尚未播种(compose 场景):
  // 回写时只验 revision 两项,页级不比。
  pages: Array<{ pageIndex: number; version: number }>;
};

export type BaselineSnapshotInput = {
  album: Pick<Album, 'draftStructureRevision' | 'settingsRevision'>;
  pages: Array<{ pageIndex: number; version: number }>;
};

export function captureJobBaseline(input: BaselineSnapshotInput): JobBaseline {
  return {
    structureRevision: input.album.draftStructureRevision,
    settingsRevision: input.album.settingsRevision,
    pages: input.pages.map((p) => ({ pageIndex: p.pageIndex, version: p.version })),
  };
}

// 锁内重验:返回失配原因(null = 新鲜,可以回写)。逐维独立判定 —— stale 详情
// 进 job error 帮助定位是哪路并发;只要有一项失配,回写即放弃(保守全拦,
// 不做「AI 结果只覆盖未变页」的选择性应用 —— 那是后续迭代)。
export function findBaselineStaleReason(
  current: BaselineSnapshotInput,
  baseline: JobBaseline | null | undefined,
): string | null {
  // 旧 job(基线机制上线前创建)无基线可验:放行,与历史行为一致。
  if (!baseline) return null;
  if (current.album.draftStructureRevision !== baseline.structureRevision) return 'structure';
  if (current.album.settingsRevision !== baseline.settingsRevision) return 'settings';
  const currentById = new Map(current.pages.map((p) => [p.pageIndex, p.version]));
  for (const page of baseline.pages) {
    // 基线页消失(结构变化删页)或版本已推进(人工/AI 编辑)都算失配。
    if (currentById.get(page.pageIndex) !== page.version) return 'pages';
  }
  return null;
}

export type DraftChanges = {
  revision: number;
  structureChanged: boolean;
  reloadRequired: boolean;
  pages: Array<{
    pageIndex: number;
    version: number;
    updatedBy: string | null;
    updatedAt: string;
    page: unknown;
  }>;
};

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// 已持相册行锁的事务内判角色(collab plan §8 步骤 2):把行锁内读到的 album
// 行直接传进来,避免 requireAccess 的无锁重读与锁内状态出现 TOCTOU 窗口。
// 返回 null = 既非 owner 也非 member。
export async function resolveRole(
  album: Album,
  userId: string,
  tx: DbOrTx = db,
): Promise<AlbumRole | null> {
  if (album.userId === userId) return 'owner';
  return (await albumMemberRepo.exists(album.id, userId, tx)) ? 'editor' : null;
}

export const collaborationService = {
  // 判定顺序(collab plan §5.2):不存在→NOT_FOUND;owner→owner;member→editor;
  // 其余→ALBUM_ACCESS_DENIED。禁止在每个路由重复实现 owner/member 判断。
  async requireAccess(userId: string, albumId: string): Promise<AlbumAccess> {
    const album = await albumRepo.findById(albumId);
    if (!album) throw ERRORS.ALBUM_NOT_FOUND();
    const role = await resolveRole(album, userId);
    if (!role) throw COLLAB_ERRORS.ALBUM_ACCESS_DENIED();
    return { album, role };
  },

  // 保留现有所有者语义(findOwned 同款):非 owner 一律 ALBUM_NOT_OWNED,
  // 不区分 editor 与路人 —— 整书级路径对两者都不开放。
  async requireOwner(userId: string, albumId: string): Promise<Album> {
    const album = await albumRepo.findById(albumId);
    if (!album) throw ERRORS.ALBUM_NOT_FOUND();
    if (album.userId !== userId) throw ERRORS.ALBUM_NOT_OWNED();
    return album;
  },

  // 创建或旋转编辑链接(collab plan §7.1/§12.3/§13)。每次调用都生成新 token
  // (upsert 覆盖),旧链接立即失效 —— 旋转即撤销。明文 token 只在这里出现一次,
  // 随响应返回,库里只有 SHA-256 hash。
  // 前置条件(invitationReadiness):V3 draft 已播种;无在途 layout/compose/add
  // job;页面引用的照片全部 uploaded(editor 只能依赖服务器原图)。
  async createEditLink(userId: string, albumId: string): Promise<{ token: string }> {
    const access = await this.requireAccess(userId, albumId);
    if (access.role !== 'owner') throw COLLAB_ERRORS.OWNER_REQUIRED();
    const album = access.album;

    const pages = await draftPageRepo.findByAlbum(albumId);
    const [latestJob, photoRows] = await Promise.all([
      agentJobRepo.findLatestByAlbum(albumId),
      albumPhotoRepo.findByAlbum(albumId),
    ]);
    const readiness = invitationReadiness({
      album,
      draftPageCount: pages.length,
      latestJob: latestJob ?? null,
      referencedPhotoIds: pages.flatMap((row) => Object.values(row.page.images ?? {})),
      uploadedPhotoIds: photoRows.filter((r) => r.status === 'uploaded').map((r) => r.photoId),
    });
    if (!readiness.ready) {
      if (readiness.reason === 'unsupported-album') throw COLLAB_ERRORS.COLLAB_UNSUPPORTED_ALBUM();
      if (readiness.reason === 'photos') throw COLLAB_ERRORS.PHOTO_BACKUP_REQUIRED();
      // 在途 job:与既有生成互斥口径一致,提示稍后重试。
      throw ERRORS.CHAT_BUSY();
    }

    const token = randomBytes(32).toString('base64url');
    await albumEditLinkRepo.upsert(db, albumId, hashToken(token), userId);
    return { token };
  },

  // 增量变化(collab plan §7.4):owner/editor 可调。返回 since 之后的单页增量;
  // since 落在最后一次结构写入(draft_structure_revision)之前 → 整书重载;
  // since 超前 → REVISION_AHEAD;空增量只回当前 revision。
  async getChanges(userId: string, albumId: string, since: number): Promise<DraftChanges> {
    const access = await this.requireAccess(userId, albumId);
    const album = access.album;

    if (!Number.isSafeInteger(since) || since < 0) {
      throw ERRORS.VALIDATION_FAILED('since must be a non-negative safe integer');
    }
    if (since > album.draftRevision) {
      throw COLLAB_ERRORS.REVISION_AHEAD({ since, currentRevision: album.draftRevision });
    }

    // 结构变化(reorder/delete/add/select-layout/compose/design-chat/replaceAll/
    // 播种)之后,页面集合可能删行/重排,version>since 的差集不再可信 —— 必须
    // 整书重载,不猜增量。
    if (since < album.draftStructureRevision) {
      return {
        revision: album.draftRevision,
        structureChanged: true,
        reloadRequired: true,
        pages: [],
      };
    }

    // version>since 下推进 SQL(2026-10-29):此前全量拉回再 JS 过滤,大书
    // 每 2.5s 一次增量轮询都要搬整书行。行集合与排序和旧实现等价。
    const rows = await draftPageRepo.findByAlbumSince(albumId, since);

    if (rows.length > DRAFT_CHANGES_MAX_PAGES) {
      return {
        revision: album.draftRevision,
        structureChanged: false,
        reloadRequired: true,
        pages: [],
      };
    }

    return {
      revision: album.draftRevision,
      structureChanged: false,
      reloadRequired: false,
      pages: rows.map((row) => ({
        pageIndex: row.pageIndex,
        version: row.version,
        updatedBy: row.updatedBy,
        updatedAt: row.updatedAt.toISOString(),
        page: row.page,
      })),
    };
  },

  // 接受邀请(collab plan §7.2)。token 只按 hash 查;旋转/乱写一律
  // EDIT_LINK_NOT_FOUND。owner redeem 自己的链接:幂等成功,不写 members
  // (invariant 2)。已是 member:重复 redeem 幂等。路由层负责 requireRealUser。
  async redeemEditLink(userId: string, token: string): Promise<{ albumId: string }> {
    const link = await albumEditLinkRepo.findByTokenHash(hashToken(token));
    if (!link) throw COLLAB_ERRORS.EDIT_LINK_NOT_FOUND();
    return db.transaction(async (tx) => {
      // Serialize membership creation with every structural/AI job dispatch.
      // Once this lock is released either the member exists (Phase 4 protects
      // future jobs via a baseline version) or the already-queued job is observed
      // here and redemption is deferred.
      const album = await albumRepo.findByIdForUpdate(tx, link.albumId);
      if (!album) throw COLLAB_ERRORS.EDIT_LINK_NOT_FOUND();
      if (album.userId === userId) return { albumId: album.id };
      const latestJob = await agentJobRepo.findLatestByAlbum(album.id, tx);
      if (latestJob && (latestJob.status === 'QUEUED' || latestJob.status === 'RUNNING')) {
        if (latestJob.kind === 'layout' || latestJob.kind === 'compose' || latestJob.kind === 'add') {
          throw ERRORS.CHAT_BUSY();
        }
      }
      await albumMemberRepo.addMemberIfAbsent(tx, album.id, userId);
      return { albumId: album.id };
    });
  },

  // 成员列表(§15.3):owner-only。返回 editor 的 userId/name/email/加入时间,
  // 供成员管理 UI 展示与移除。
  async listMembers(
    userId: string,
    albumId: string,
  ): Promise<Array<{ userId: string; name: string | null; email: string; createdAt: string }>> {
    await this.requireOwner(userId, albumId);
    const rows = await albumMemberRepo.listByAlbum(albumId);
    // 批量查(2026-10-29):一次 IN 替代逐个 findById 的 N+1。
    const users = await userRepo.findByIds(rows.map((row) => row.userId));
    return rows.map((row) => ({
      userId: row.userId,
      name: users.get(row.userId)?.name ?? null,
      email: users.get(row.userId)?.email ?? '',
      createdAt: row.createdAt.toISOString(),
    }));
  },

  // 移除 editor(§15.3/§12.2):owner-only。删除后该成员后续轮询/保存立即 403
  // (requireAccess 查 member 落空);已打开页面不被远程强关,但无法再持久化。
  async removeMember(userId: string, albumId: string, memberUserId: string): Promise<{ removed: boolean }> {
    await this.requireOwner(userId, albumId);
    const removed = await albumMemberRepo.removeMember(db, albumId, memberUserId);
    return { removed };
  },
};
