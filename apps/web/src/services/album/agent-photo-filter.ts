import { z } from 'zod';
import { db, type DbOrTx } from '@/db/client';
import { albumRepo } from '@/db/repos/album-repo';
import { albumShareRepo } from '@/db/repos/album-share-repo';
import { ERRORS } from '@/lib/api/error-codes';
import {
  PhotoFilterRefSchema,
  effectiveRenderVersion,
  normalizePhotoFilterState,
  photoFilterStatesEqual,
  type PhotoFilterState,
} from '@/lib/photo/filter-state';
import { lockAlbumForSettingsWrite } from './album-service';

/**
 * design-agent 写滤镜/抠图的跨存储 seam。
 *
 * ⚠️ 两套 OCC,这个 seam **只碰前者**:
 *   - 滤镜/抠图 → `albums.photo_filter` 列,走 `settingsRevision`
 *   - 页面      → `draft_pages` 行,走页面 `version`
 * design-agent 的 commitWrite 只认后者。这里不碰 `draft_json`、不碰任何页面
 * `version`、不推进 `draftRevision` / `draftStructureRevision`。
 *
 * 锁**必须**复用 `album-service.ts` 的 `lockAlbumForSettingsWrite` —— 那道行锁
 * 里的四步(行锁 / 锁内 resolveRole / 基线整数校验 / settingsRevision 精确比较)
 * 是协同编辑 OCC 的防线,自写行锁会绕过其中某一步造成并发脏写。
 */

// patch 是**增量合并**,不是整替:没提到的维度原样保留。
//   default  省略 = 不动;null = 整本回原片;ref = 整本换 LUT
//   overrides 逐 photoId 合并;值 null = 该张显式原片(契约语义,不是删键)
//   cutouts   true = 开;null = **删键**(见下方铁律)
const AgentPhotoFilterPatchSchema = z.object({
  default: PhotoFilterRefSchema.nullable().optional(),
  overrides: z.record(z.string(), PhotoFilterRefSchema.nullable()).optional(),
  // 铁律:cutouts 只认 true。关掉是删键,**绝不写 false** —— 允许 false 会让
  // 「没抠」有两种表示,renderVersion 和派生缓存 key 立刻产生歧义。
  // 这里收 null 只是「关掉」这个**意图**的线上表示,落库时走删键。
  cutouts: z.record(z.string(), z.union([z.literal(true), z.null()])).optional(),
}).strict();

export type AgentPhotoFilterPatch = z.infer<typeof AgentPhotoFilterPatchSchema>;

export type AgentPhotoFilterResult = {
  photoFilter: PhotoFilterState | null;
  settingsRevision: number;
  /** 给工具层塞进模型 notes 的提醒。空数组 = 没什么要说的。 */
  warnings: string[];
};

/** patch 合并进现有状态。cutouts 的 null 走删键,全空时连壳一起删。 */
function mergePatch(
  current: PhotoFilterState | null,
  patch: AgentPhotoFilterPatch,
): PhotoFilterState {
  const base: PhotoFilterState = current ?? { default: null };

  const nextOverrides = { ...(base.overrides ?? {}), ...(patch.overrides ?? {}) };

  const nextCutouts: Record<string, true> = { ...(base.cutouts ?? {}) };
  for (const [photoId, on] of Object.entries(patch.cutouts ?? {})) {
    // 关掉 = delete。这一行是上面那条铁律的执行点,别改成 `nextCutouts[id] = false`。
    if (on === true) nextCutouts[photoId] = true;
    else delete nextCutouts[photoId];
  }

  return {
    default: patch.default !== undefined ? patch.default : base.default,
    ...(Object.keys(nextOverrides).length > 0 ? { overrides: nextOverrides } : {}),
    // 全关之后连 cutouts 这个壳一起删掉,免得存库 JSON 里留一个空对象。
    ...(Object.keys(nextCutouts).length > 0 ? { cutouts: nextCutouts } : {}),
  };
}

export async function applyAgentPhotoFilter(
  userId: string,
  albumId: string,
  patch: unknown,
  // 阶段 A 过渡态:owner 可省略(走旧盲写),editor 省略一律拒绝 —— 见
  // lockAlbumForSettingsWrite。
  baseSettingsRevision?: number,
): Promise<AgentPhotoFilterResult> {
  // 入参校验在锁外:不认识的 lutId / 越界 strength / 未知键,在开事务之前就拒掉,
  // 零写入。
  const parsed = AgentPhotoFilterPatchSchema.safeParse(patch);
  if (!parsed.success) {
    throw ERRORS.VALIDATION_FAILED(
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
  }

  return db.transaction(async (tx) => {
    const latest = await lockAlbumForSettingsWrite(tx, userId, albumId, baseSettingsRevision);
    // strength 归一化沿用 normalizePhotoFilterState 里的 quantizeStrength,不新写。
    const photoFilter = normalizePhotoFilterState(mergePatch(latest.photoFilter, parsed.data));

    // 同值重写是**空操作**。下面那次 update 是无条件清 PDF/封面派生物 + 把
    // COMPLETED 打回 EDITING 的:不判「真的变了没有」的话,用户再问一句
    // 「确认下调色」→ Agent 把同一份滤镜再写一遍 → PDF 链接和封面缩略图凭空
    // 消失、书退回 EDITING。判定过 normalizePhotoFilterState(strength 52 与 50
    // 归一后同值),返回的是**库里那份**权威状态,调用方照常拿得到。
    if (photoFilterStatesEqual(latest.photoFilter, photoFilter)) {
      return {
        photoFilter: normalizePhotoFilterState(latest.photoFilter),
        settingsRevision: latest.settingsRevision,
        // 版本串逐字节没变 => 分享快照不会失配,没什么要告知的。
        warnings: [],
      };
    }

    const settingsRevision = latest.settingsRevision + 1;

    const warnings = await shareMismatchWarnings(tx, albumId, latest, photoFilter);

    await albumRepo.update(tx, albumId, {
      photoFilter,
      settingsRevision,
      // 改滤镜会让 PDF/封面缩略图的像素过期 —— 与 albumService.updatePhotoFilter
      // 同口径清掉派生元数据,否则 Agent 改完书里还挂着旧滤镜的 PDF。
      pdfUrl: null,
      pdfR2Key: null,
      coverThumbnailUrl: null,
      coverThumbnailR2Key: null,
      ...(latest.status === 'COMPLETED' ? { status: 'EDITING' as const } : {}),
    });

    return { photoFilter, settingsRevision, warnings };
  });
}

/**
 * 分享快照护栏。改滤镜/抠图会改 `effectiveRenderVersion`,而 share-service 建分享时
 * 拿它跟备份里记的版本串精确比对(share-service.ts:108)—— 一句「整本调成旅行大片」
 * 就能让全书失配,用户得重新备份全书,还撞备份 300 张上限那堵墙。
 *
 * 按小雨拍板的「Agent 全权」:**告知,不阻断**。warning 走工具 notes 让 Agent 在
 * 回复里说清楚,不静默改。
 *
 * 判定口径与 share-service 的闸门一致:只看**已备份的那批 photoId**(备份集合就是
 * 分享页引用的那批)。没分享 / 版本串逐字节没变 / 只动了不在备份里的照片 —— 都不
 * 出声,免得每次调色都刷一条假警报。
 */
async function shareMismatchWarnings(
  tx: DbOrTx,
  albumId: string,
  before: { photoFilter: PhotoFilterState | null; photoSnapshot: { photoIds: string[] } | null },
  after: PhotoFilterState | null,
): Promise<string[]> {
  const photoIds = before.photoSnapshot?.photoIds ?? [];
  const changed = photoIds.filter(
    (photoId) =>
      effectiveRenderVersion(before.photoFilter, photoId)
      !== effectiveRenderVersion(after, photoId),
  );
  if (changed.length === 0) return [];
  // 版本串真变了才去查分享 —— 大多数调用不会走到这条查询。
  if (!(await albumShareRepo.existsByAlbum(albumId, tx))) return [];

  return [
    `这本书已经分享过。这次改动会让 ${changed.length} 张照片的渲染版本变化,`
    + '已发出的分享链接会显示不出这些照片,需要在编辑器里重新备份全书后重新分享'
    + '(备份单次上限 300 张,大书要分几次)。请在回复里告诉用户这件事。',
  ];
}
