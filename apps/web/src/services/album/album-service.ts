import { bakePageHtml, bakePagesHtml, type BakeablePage } from './bake-html';
import { bumpDraftRevision, ensureDraftPagesSeeded, envelopeJson, loadStoryDraft, parseDraftEnvelope, readPreviewPages } from './draft-store';
import { createHash } from 'node:crypto';
import { normalizeBoardBackground, type BoardBackground } from '@/lib/board-bg/presets';
import { patchHtmlImagePos, patchHtmlPageStyle, patchHtmlText, patchHtmlTextStyle } from '@/components/album/page-html-dom';
import { db, type DbOrTx } from '@/db/client';
import { albumRepo } from '@/db/repos/album-repo';
import { albumMessageRepo } from '@/db/repos/album-message-repo';
import { albumPageRepo } from '@/db/repos/album-page-repo';
import type { Album } from '@/db/schema';
import { draftPageRepo } from '@/db/repos/draft-page-repo';
import { albumPhotoRepo } from '@/db/repos/album-photo-repo';
import { albumShareRepo } from '@/db/repos/album-share-repo';
import { applyAgentPhotoFilter } from './agent-photo-filter';
import { agentJobRepo } from '@/db/repos/agent-job-repo';
import { jobService, mergeComposeIntoDraft, readComposeAppendMeta, type ComposeJobMeta } from '@/services/job/job-service';
import { collaborationService, resolveRole } from '@/services/collaboration/collaboration-service';
import { COLLAB_ERRORS } from '@/services/collaboration/collaboration-errors';
import { creditService } from '@/services/credit/credit-service';
import { draftExpirySweeper } from '@/services/job/draft-expiry-sweeper';
import { agentClient } from '@/lib/agent/agent-client';
import { designAgentClient } from '@/lib/agent/design-agent-client';
import { r2 } from '@/lib/r2/r2-client';
import { ERRORS } from '@/lib/api/error-codes';
import { getTemplate } from '@yujee/contracts/templates';
import { transientPagePhotoRefs } from './page-photo-refs';
import { getPhotoProfiles, withPhotoProfiles } from './photo-profile-service';
import { photoMaskService } from './photo-mask-service';
import { extractDesignFromPages } from './append-photos';
import {
  buildCoverSets,
  designAppliedMarker,
  pickHeroPhotos,
  reconcileDraftDesign,
  slotSpecs,
  templateCategory,
} from './design-apply';
import { env } from '@/lib/env';
import { logger } from '@/lib/log/logger';
import { isValidPageBackground } from '@/lib/design/page-backgrounds';
import { coverColorwayById } from '@/lib/design/third-set-palette';
import {
  PhotoFilterStateSchema,
  normalizePhotoFilterState,
  type PhotoFilterState,
} from '@/lib/photo/filter-state';
import {
  PHOTO_SNAPSHOT_MAX_COUNT,
  SnapshotEntriesSchema,
  mergePhotoSnapshot,
  photoSnapshotKey,
  photoSnapshotRenderVersions,
  photoSnapshotUrls,
  type SnapshotEntry,
} from './photo-snapshot-util';
import {
  ComposeRequest,
  Page,
  V3AnalyzeImageDataUrl,
  V3StoryDraft,
  type ImagePos,
  type Page as V3Page,
  type V3Chapter,
  type V3LayoutTree as V3LayoutTreeT,
  type V3StoryProgress,
  type V3LayoutPatchEntry,
  type V3ChapterOverview,
  type V3InternalAgentDataRequest,
} from '@yujee/contracts';

const PDF_MAX_BYTES = 50 * 1024 * 1024; // 50MB — docs/web/api.md §3.6
const COVER_THUMB_CONTENT_TYPE = 'image/jpeg';
const COVER_THUMB_MAX_BYTES = 512 * 1024;
const PHOTO_SNAPSHOT_CONTENT_TYPE = 'image/jpeg';

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

async function coverThumbnailRevision(
  tx: DbOrTx,
  album: {
    id: string;
    draftJson: unknown;
    photoFilter: PhotoFilterState | null;
    updatedAt: Date;
  },
): Promise<string> {
  const draft = readStoryDraft(album.draftJson);
  const draftCoverPage = draft?.pages?.find((page) => page.pageIndex === 0);
  const storedCoverPage = draft?.pages?.length
    ? null
    : await albumPageRepo.findOne(tx, album.id, 0);
  const state = canonicalJson({
    photoFilter: normalizePhotoFilterState(album.photoFilter),
    updatedAt: album.updatedAt.toISOString(),
    coverPage: draftCoverPage ?? (storedCoverPage
      ? {
          pageIndex: storedCoverPage.pageIndex,
          templateId: storedCoverPage.templateId,
          imagesJson: storedCoverPage.imagesJson,
          textsJson: storedCoverPage.textsJson,
          imagePosJson: storedCoverPage.imagePosJson,
        }
      : null),
  });
  return createHash('sha256').update(state).digest('hex');
}

// my-albums 列表项投影(collab rework §15.2):Album 行 → 前端卡片 DTO。纯函数、
// 零副作用,抽出是为了在**无库环境**(闸门/CI)也能测 role 透传与封面兜底规则 ——
// listByUser 的 DB 测试在无库时会静默 skip,新查询否则没有真实覆盖。
export function toMyAlbumListItem(
  a: Album,
  role: 'owner' | 'editor',
  status: Album['status'],
  coverPage: AlbumCoverPage | null,
) {
  return {
    id: a.id,
    title: a.title,
    status,
    // 协同(collab rework §15.2):调用者在这本书上的角色。旧客户端不读此字段,
    // 向后兼容。
    role,
    photoCount: a.photoCount,
    pageCount: a.pageCount,
    pdfUrl: a.pdfUrl,
    coverThumbnailUrl: a.coverThumbnailUrl ?? null,
    photoFilter: a.photoFilter ?? null,
    createdAt: a.createdAt,
    coverPage,
    // 服务器压缩快照 URL 刻意**只给 getDetail**(编辑页回退渲染本地缺失的原图)。
    // 列表端点不投影 —— 4s 轮询下塞全量 URL 会让 payload 爆炸,且公开 URL 常态化
    // 下发给 editor 无法在踢人后撤销。
    // 已有封面页或已存缩略图就不用兜底,省掉无谓的 draft 解析与线上负载。
    fallbackPhotoIds:
      coverPage || a.coverThumbnailUrl ? [] : albumService.fallbackCoverPhotoIds(a.draftJson),
  };
}

type AlbumCoverPage = {
  pageIndex: number;
  templateId: string;
  imagesJson: Record<string, string>;
  textsJson: Record<string, string>;
  imagePosJson: Record<string, ImagePos>;
};

// ── ② 章节故事完成度(WP2.4 / §4.2(1)) ───────────────────────────────────
//
// `albums.draft_json` 在 V3 里有两种合法形态(无新增 DB 迁移):
//   ① 裸 `V3LayoutTree`(WP1.5 #184 analyze-completed 直接写入的预览树);
//   ② 包裹形 `V3StoryDraft = { version, tree, progress }`(WP2.4 起,带章级 done + 当前章)。
// 读时一律归一化成「树 + 进度」:裸树视作进度初态(当前章 = 第一章,done 集合空)。
// 写回 done/当前章时升级成包裹形,WP1.5 的写入路径不变(向后兼容)。
//
// stage(五环节走到哪)永远在 `albums.stage` 列(architecture §6.8 第 4 条),
//   **不**塞进 draft_json;progress 只管「章级 done + 当前章」这一颗粒度。

type NormalizedStoryDraft = {
  tree: V3LayoutTreeT;
  pages?: V3Page[];
  progress: V3StoryProgress;
};

type V3LayoutPatchEntryWithImagePos = V3LayoutPatchEntry & {
  imagePos?: Record<string, ImagePos>;
};

type StoryProgressState = {
  stage: string;
  chapterOrder: string[];
  doneChapterIds: string[];
  currentChapterId: string | null;
  allDone: boolean;
  exportUnlocked: boolean;
};

// draft_pages 拆表(Phase 1a):moved to `./draft-store` (pure, no DB) so
// `loadStoryDraft` can reuse it too. Re-exported here so nothing importing it
// from album-service.ts (share-service.ts) breaks.
export { readPreviewPages };

// Parse draft_json into { tree, progress }, tolerating both the bare-tree and the
// wrapped shape. Returns null when draft_json isn't a V3 story draft at all (no
// draft / finalized album). The initial currentChapterId is the FIRST not-done
// chapter so a bare tree resumes from chapter 1.
//
// draft_pages 拆表(Phase 1a): the {tree, progress, design} parsing itself now
// lives in `./draft-store` (`parseDraftEnvelope`), shared with `loadStoryDraft`.
// This function stays as a thin wrapper around it — it stays synchronous (pure
// off draftJson, no DB row read) and preserves a legacy baking asymmetry that
// `loadStoryDraft` deliberately does NOT replicate: only the WRAPPED branch's
// pages get baked on read here (bare-tree fallback pages come back unbaked, as
// they always have — `readPreviewPages` never bakes). Task 8/9 migrate every
// caller of this function onto `loadStoryDraft`.
function readStoryDraft(draftJson: unknown): NormalizedStoryDraft | null {
  const envelope = parseDraftEnvelope(draftJson);
  if (!envelope) return null;

  const wrapped = V3StoryDraft.safeParse(draftJson);
  const pages = wrapped.success
    ? wrapped.data.pages
      ? // C 方案读路径兜底:存量 draft(烘 HTML 上线前落库)的页缺 html,读出时
        // 现场烘一遍(不回写库;之后任何写路径落库即固化)。lenient 见 bake-html。
        (bakePagesHtml(wrapped.data.pages as BakeablePage[], { strict: false }) as typeof wrapped.data.pages)
      : wrapped.data.pages
    : readPreviewPages(draftJson);

  return { tree: envelope.tree, pages, progress: envelope.progress };
}

// ② 章节故事 — server-side single-chapter slice for /v3/chapter-chat (§8.3 单章切片;
// invariant 12: the authoring tree NEVER round-trips through the browser, so the
// browser sends only a chapterId and Web re-slices draft_json here). Returns the
// chapter's V3Chapter node + the raw Page[] whose images reference that chapter's
// photos (same membership rule getDraftSkeleton uses). Pages keep their STORED
// draft_json pageIndex so the agent's pagesTexts/layoutPatch echo back the same key
// (the browser then matches that index 1:1). This relies on analyze writing sequential
// page indices (skeleton_v3 page_index = len(pages)); if a future flow reorders/removes
// draft pages it MUST keep pageIndex stable, or write/edit patches would target the
// wrong page browser-side.
function sliceChapterForChat(
  normalized: NormalizedStoryDraft,
  chapterId: string,
): { chapter: V3Chapter; pages: V3Page[] } | null {
  const chapter = normalized.tree.chapters.find((c) => c.chapterId === chapterId);
  if (!chapter) return null;
  const photoIds = new Set(chapter.photos.map((p) => p.photoId));
  const pages = (normalized.pages ?? []).filter((page) => {
    // Cover/ending pages belong to no chapter — analyze seeds them by REUSING the book's
    // first/last photo (a chapter's hero), so without this guard a cover/ending page would
    // leak into that chapter's chat slice and get rewritten by chapter-chat. (toc pages are
    // intentionally left as-is: they carry no reused hero and predate this change.)
    const category = getTemplate(page.templateId)?.category;
    if (category === 'cover' || category === 'ending') return false;
    return Object.values(page.images).some((id) => photoIds.has(id));
  });
  return { chapter, pages };
}

// ③ 主题/章节色 · 推荐 — server-side text-only slice for /v3/recommend (缺口#20;
// invariant 12: the authoring tree NEVER round-trips through the browser, so the
// browser sends NO chapter overview — Web re-slices it from draft_json here). Maps each
// V3Chapter to a V3ChapterOverview (chapterId + description + each photo's
// sceneDescription摘要, ≤12). No base64 (§3 privacy by construction): only text descs.
// 章节展示名的单一口径:title(分析期确定性派生的章标识)→ description(写目录环节
// 才填,老树里可能存着旧标题)→ 调用方给的兜底。老相册 draft_json 没有 title 键,
// zod 的 .default('') 会补空串,所以这两级降级必须留着。
function chapterLabel(chapter: { title?: string; description?: string }, fallback: string): string {
  return chapter.title || chapter.description || fallback;
}

function buildRecommendOverviews(tree: V3LayoutTreeT): V3ChapterOverview[] {
  return tree.chapters.map((chapter) => ({
    chapterId: chapter.chapterId,
    description: chapter.description.slice(0, 600),
    ...(chapter.extractedColor !== undefined ? { extractedColor: chapter.extractedColor } : {}),
    photoDescs: chapter.photos.slice(0, 12).map((p) => p.sceneDescription),
  }));
}

// ③④ — the SAME chapter→pages membership rule sliceChapterForChat / getDraftSkeleton
// use (and getDraftSkeleton's chapterIdForPage), applied to ALL pages keyed by their
// stored draft_json pageIndex. apply-theme / cover re-slice the relevant pages
// SERVER-SIDE from draft_json (§8.3 ③④传相关页; invariant 12: the browser never holds
// the layout pages, so it sends only its selections). Like getDraftSkeleton, a
// cover/toc/ending page maps to null (chapter membership is for interior pages only), so
// apply-theme targets the chapter (interior) pages and cover targets the rest.
function chapterIdForDraftPage(normalized: NormalizedStoryDraft, page: V3Page): string | null {
  const category = getTemplate(page.templateId)?.category;
  if (category === 'cover' || category === 'toc' || category === 'ending') return null;
  const refs = new Set(Object.values(page.images));
  const match = normalized.tree.chapters.find((chapter) =>
    chapter.photos.some((photo) => refs.has(photo.photoId)),
  );
  return match?.chapterId ?? null;
}

// The chapter title (#236): apply-theme persists each chapter's `subject` into its
// `title` role text slot (Page.texts). Read it back from the first of a chapter's pages
// whose template declares a non-empty `title` slot value, so the draft skeleton can
// surface the title for the chapter card / rail. Returns undefined before the theme
// stage has run (no title written yet) — callers fall back to a generic label.
function titleOfChapterPages(pages: V3Page[]): string | undefined {
  for (const page of pages) {
    const template = getTemplate(page.templateId);
    if (!template) continue;
    const titleSlotId = (template.texts ?? []).find((slot) => slot.role === 'title')?.id;
    if (!titleSlotId) continue;
    const value = page.texts[titleSlotId];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

// PG 唯一索引冲突(SQLSTATE 23505)。只有它才代表「已经有一条在途 job」,别的 DB 错误
// (连接断开、序列化失败、枚举值不存在)绝不能被当成幂等成功吞掉。
function isUniqueViolation(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const record = e as { code?: unknown; cause?: unknown };
  if (record.code === '23505') return true;
  // 驱动/ORM 可能把原始错误包一层(drizzle 的 DrizzleQueryError 就挂在 cause 上)。
  return record.cause ? isUniqueViolation(record.cause) : false;
}

// 相册默认标题(generation-service.ts:61 的兜底值)。它不是用户起的书名 ——
// 传给 compose 会被 prompt 当成「用户自己定的书名,原样使用」,导致封面大标题恒为
// My Memoir、AI 从来没机会写封面标题。判定为默认就传空串,让 AI 自己起。
export const DEFAULT_ALBUM_TITLES = ['My Memoir', '我的故事'] as const;

export function isDefaultAlbumTitle(title: string | null | undefined): boolean {
  const t = (title ?? '').trim();
  return t === '' || DEFAULT_ALBUM_TITLES.some((d) => d === t);
}

/**
 * ④ 成稿请求装配(纯函数,便于单测):按章切片 —— 每章带【真实照片 200px 缩略图】+
 * 【用户讲的故事(chapterContext)】+【本章已选定版式的页】,封面/封尾只给文字槽 spec。
 * · 页归章:页里任一图槽的 photoId 属于该章即算该章(与 getDraftSkeleton 同口径);
 * · 缺 200px ref 的照片跳过(不硬失败:成稿是叠加性的一步,少一张也照常出稿);
 * · place 是城市级地名文字(§3 允许),坐标绝不出现。
 */
export function buildComposeRequest(input: {
  requestId: string;
  callbackUrl: string;
  language: 'zh' | 'en';
  albumTitle: string;
  coverTemplateId: string;
  endingTemplateId: string;
  chapters: Array<{
    chapterId?: string;
    title?: string;
    chapterContext?: string;
    place?: string;
    photos?: Array<{ photoId: string; takenAt?: string | null }>;
  }>;
  interiorPages: V3Page[];
  refs: Record<string, string>;
}): ComposeRequest {
  const chapters = input.chapters.flatMap((chapter, i) => {
    const chapterId = chapter.chapterId ?? `c${i + 1}`;
    const photoIds = new Set((chapter.photos ?? []).map((p) => p.photoId));
    const pages = input.interiorPages.filter((page) =>
      Object.values(page.images).some((pid) => photoIds.has(pid)),
    );
    const photos = (chapter.photos ?? []).flatMap((photo) => {
      const ref200px = input.refs[photo.photoId];
      // 缺 ref 跳过;格式不合法/超 800KB 的 ref 同样只当这一张缺席 —— 否则一张坏图会
      // 让整个 ComposeRequest 校验失败,用户拿 400、整本书写不出来,与「少一张也照常
      // 出稿」的硬约束相悖。
      if (!ref200px || !V3AnalyzeImageDataUrl.safeParse(ref200px).success) return [];
      return [
        {
          photoId: photo.photoId,
          ref200px,
          ...(photo.takenAt ? { takenAt: photo.takenAt } : {}),
          ...(chapter.place ? { place: chapter.place } : {}),
        },
      ];
    });
    return [
      {
        chapterId,
        // 章标识优先用树上的确定性 title,老树没有就退回本章页面已写进 title 槽的值。
        title: (chapter.title || titleOfChapterPages(pages) || '').slice(0, 120),
        chapterContext: (chapter.chapterContext ?? '').slice(0, 500),
        photos,
        pages: pages.map((page) => ({
          pageIndex: page.pageIndex,
          templateId: page.templateId,
          images: page.images,
        })),
      },
    ];
  });

  const parsed = ComposeRequest.safeParse({
    requestId: input.requestId,
    callbackUrl: input.callbackUrl,
    language: input.language,
    albumTitle: isDefaultAlbumTitle(input.albumTitle) ? '' : input.albumTitle.slice(0, 120),
    coverTemplateId: input.coverTemplateId,
    endingTemplateId: input.endingTemplateId,
    coverSlots: slotSpecs(input.coverTemplateId),
    endingSlots: slotSpecs(input.endingTemplateId),
    chapters,
  });
  if (!parsed.success) {
    throw ERRORS.VALIDATION_FAILED(
      parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
    );
  }
  return parsed.data;
}

function storyProgressFrom(stage: string, normalized: NormalizedStoryDraft | null): StoryProgressState {
  const chapterOrder = normalized?.tree.chapters.map((c) => c.chapterId) ?? [];
  const doneSet = new Set(normalized?.progress.doneChapterIds ?? []);
  // allDone is derived from the tree+done set, NOT from stage, so a stale stage
  // cannot unlock export unless every chapter is explicitly confirmed.
  const allDone = chapterOrder.length > 0 && chapterOrder.every((id) => doneSet.has(id));
  return {
    stage,
    chapterOrder,
    doneChapterIds: chapterOrder.filter((id) => doneSet.has(id)),
    currentChapterId: normalized?.progress.currentChapterId ?? null,
    allDone,
    // 2026-07 设计环节收紧:导出解锁 ⇔ allDone 且设计已完成(stage='ready',由
    // applyDesign 推进)。theme/cover 不再解锁;stage 也不够 —— 每章都必须 done
    // (追加照片的新章在追加排版完成前会令 allDone=false,导出自动重锁)。
    // 前端镜像:editor-v2/export-gate-util.computeExportUnlocked,两处同改。
    exportUnlocked: allDone && stage === 'ready',
  };
}

// 排版续跑止血:某 album 的 layout job 处于哪种态。有在跑的(QUEUED/RUNNING)→ 'running';
// 否则最近一条 layout job 是 FAILED → 'failed';都没有(没排过 / 上次成功落页)→ 'idle'。
// ChatPanel 重进时据此决定:接着等 / 自动重排 / 不动(有页就正常进设计)。刻意不把 pages
// 塞进响应 —— 前端自查画板页数(co().getPagesState()),Web 只回 job 层的排版态。
type LayoutState = 'running' | 'failed' | 'idle';
async function resolveLayoutState(albumId: string): Promise<LayoutState> {
  if (await agentJobRepo.findActiveLayoutByAlbum(albumId)) return 'running';
  const latest = await agentJobRepo.findLatestLayoutByAlbum(albumId);
  return latest?.status === 'FAILED' ? 'failed' : 'idle';
}

function assertStoryExportUnlocked(album: Awaited<ReturnType<typeof albumRepo.findById>>): void {
  if (!album) throw ERRORS.ALBUM_NOT_FOUND();
  const normalized = readStoryDraft(album.draftJson);
  // V1/V2/finalized rows do not use the V3 story gate.
  if (!normalized) return;
  if (!storyProgressFrom(album.stage, normalized).exportUnlocked) {
    throw ERRORS.VALIDATION_FAILED('finish all story chapters and the design step before export');
  }
}

// ── 全局创作设置 OCC(Phase 2B)────────────────────────────────────────────
// title / boardBackground / photoFilter 三个相册级设置写的共享事务骨架:
// ①行锁 ②resolveRole(owner/editor 同为 Creator)③safe integer 校验
// ④与 settingsRevision 精确比较,失配 409 SETTINGS_CONFLICT 零写入。返回锁内
// album 行,供调用方落字段写并推进 settingsRevision+1。必须在 db.transaction 内调用。
// 导出给 design-agent 的滤镜写入 seam(agent-photo-filter.ts)复用 —— 那条路径
// 必须走这道锁,不许自写行锁:①②③④ 这四步是协同 OCC 的防线,绕过任何一步都是
// 并发脏写。
export async function lockAlbumForSettingsWrite(
  tx: DbOrTx,
  userId: string,
  albumId: string,
  baseSettingsRevision: number | undefined,
) {
  const latest = await albumRepo.findByIdForUpdate(tx, albumId);
  if (!latest) throw ERRORS.ALBUM_NOT_FOUND();
  // ② 协同访问:owner 与 editor 都是 Creator,都可改全局设置;非成员拒绝。行锁内
  // 判角色,与 updatePage/reorderPages/deletePage 同一 TOCTOU 防线。
  const role = await resolveRole(latest, userId, tx);
  if (!role) throw COLLAB_ERRORS.ALBUM_ACCESS_DENIED();
  // ③ 发布阶段 A(§16)的过渡态,与 updatePage 的 baseVersion 完全同一口径:
  // owner 旧客户端不带基线时走旧盲写(前端尚未发这个字段,必填会让 owner 自己
  // 也改不了书名/背景/滤镜);editor 不带一律拒绝 —— 协同并发的安全性由这条守,
  // 不依赖 schema 的必填。前端全部带上后收紧。
  if (baseSettingsRevision === undefined) {
    if (role === 'editor') {
      throw ERRORS.VALIDATION_FAILED('baseSettingsRevision is required for collaborative saves');
    }
    return latest;
  }
  // ④ 基线必须是 0..MAX_SAFE_INTEGER 的整数(settingsRevision 从 0 单调自增)。
  if (!Number.isSafeInteger(baseSettingsRevision) || baseSettingsRevision < 0) {
    throw ERRORS.VALIDATION_FAILED('baseSettingsRevision must be a non-negative safe integer');
  }
  // ⑤ 精确比较:失配即 409 SETTINGS_CONFLICT(零写入、零推进,事务回滚)。
  if (latest.settingsRevision !== baseSettingsRevision) {
    throw COLLAB_ERRORS.SETTINGS_CONFLICT({
      currentSettingsRevision: latest.settingsRevision,
    });
  }
  return latest;
}

export const albumService = {
  async create(tx: DbOrTx, input: {
    userId: string;
    prompt: string;
    photoCount: number;
    title: string;
  }): Promise<{ albumId: string }> {
    const album = await albumRepo.create(tx, {
      userId: input.userId,
      title: input.title,
      prompt: input.prompt,
      photoCount: input.photoCount,
      status: 'AGENT_RUNNING',
      pageCount: 0,
    });
    return { albumId: album.id };
  },

  async findOwned(userId: string, albumId: string) {
    const album = await albumRepo.findById(albumId);
    if (!album) throw ERRORS.ALBUM_NOT_FOUND();
    if (album.userId !== userId) throw ERRORS.ALBUM_NOT_OWNED();
    return album;
  },

  // Retry transition (§6.5.3): claim a FAILED album back to AGENT_RUNNING so the
  // SAME album is reused for a rerun — no new album, no orphaned failed card. The
  // transition is conditional (only wins from FAILED), so a double-click or a
  // retry racing the stale-job sweep can't start two generations or double-hold
  // credit; the loser throws ALBUM_NOT_RETRIABLE and retryAnalyzeV3 aborts before
  // the hold. errorMessage is cleared so the album reads clean.
  // Caller must hold ownership (findOwned) before invoking inside its tx.
  async setRetrying(tx: DbOrTx, albumId: string): Promise<void> {
    const won = await albumRepo.transitionStatus(tx, albumId, 'AGENT_RUNNING', ['FAILED'], {
      errorMessage: null,
    });
    if (!won) throw ERRORS.ALBUM_NOT_RETRIABLE();
  },

  // The browser polls this by album uuid — album is the source of truth. While
  // status is AGENT_RUNNING we resolve the latest job for live stage/progress,
  // which also opportunistically sweeps a zombie (dead job → FAILED + credit
  // release) so a stuck album self-heals on the next look instead of spinning.
  async getDetail(userId: string, albumId: string) {
    // 协同白名单读路径(collab plan §5.1):owner/editor 可读。相册页面首先
    // 请求 v1 detail,若仍走 findOwned,editor 会在加载 draft 之前就收到 403。
    // role 随投影返回(§7.3):客户端隐藏 owner-only 入口;权限由后端兜底。
    const access = await collaborationService.requireAccess(userId, albumId);
    let album = access.album;

    let generation: { stage: string | null; progress: number } | null = null;
    if (album.status === 'AGENT_RUNNING') {
      const resolved = await jobService.resolveGeneration(albumId);
      if (resolved?.kind === 'swept') {
        album = (await albumRepo.findById(albumId)) ?? album; // now FAILED
      } else if (resolved?.kind === 'progress') {
        generation = { stage: resolved.stage, progress: resolved.progress };
      }
    } else if (album.status === 'EDITING') {
      // Read-time draft-expiry sweep (rebuild-tech-plan §12). Under §6.7 charge-at-init
      // the draft's hold is already SETTLED, so this no longer finds a HOLDING hold to
      // release — kept as a harmless safety net (see draft-expiry-sweeper.ts). The album
      // stays EDITING with its draft_json intact (no status change, nothing to reload).
      await draftExpirySweeper.sweepAlbumOnRead(albumId);
      // 解耦后 select-layout 是独立 layout job,相册仍是 EDITING。若有在跑的 layout job,把它的
      // stage/progress 透出 —— 编辑器/轮询靠此知道排版还在跑(stage=layout),等 completed 落
      // pages。非 layout 的残留 job 不透出。
      const resolved = await jobService.resolveGeneration(albumId);
      if (resolved?.kind === 'progress' && resolved.stage === 'layout') {
        generation = { stage: resolved.stage, progress: resolved.progress };
      }
    }

    const [pages, photoOriginals] = await Promise.all([
      albumPageRepo.findByAlbum(db, albumId),
      albumPhotoRepo.countByStatus(albumId),
    ]);
    return {
      album: {
        id: album.id,
        title: album.title,
        status: album.status,
        // 协同(collab plan §7.3):与 v3 draft 的角色口径一致。
        role: access.role,
        // 结构 OCC 基线(Phase 2A):与 v3 draft skeleton 同口径。
        structureRevision: album.draftStructureRevision,
        // 全局创作设置 OCC 基线(Phase 2B):title/背景/滤镜提交时的 baseSettingsRevision。
        settingsRevision: album.settingsRevision,
        // V3 五环节状态 (WP2.4). Orthogonal to status; the editor reads it to drive
        // the breadcrumb + the story gate. Always present (column default 'analysing').
        stage: album.stage,
        prompt: album.prompt,
        layoutJson: album.layoutJson ?? null,
        photoCount: album.photoCount,
        pageCount: album.pageCount,
        pdfUrl: album.pdfUrl,
        coverThumbnailUrl: album.coverThumbnailUrl,
        // 手动备份过的照片的服务器压缩图 URL(photoId→url)。resolveImage 在本地原图
        // 缺失时回退到它,让换设备/清缓存后内页不空白。未备份 → {}。
        // key 固定 **owner**(album.userId)命名空间(collab rework §3.3:备份执行者
        // 可能是 editor,但快照字节始终写在 owner 命名空间,读侧派生必须一致 ——
        // 用调用者 userId 会让 editor 读到一串不存在的 URL,内页全空白)。
        photoSnapshotUrls: photoSnapshotUrls(
          album.userId,
          album.id,
          album.photoSnapshot?.photoIds,
          r2.publicUrl,
          album.photoSnapshot?.renderVersions,
        ),
        photoSnapshotRenderVersions: photoSnapshotRenderVersions(
          album.photoSnapshot?.photoIds,
          album.photoSnapshot?.renderVersions,
        ),
        // album_photos 里 uploaded/missing 的行数(照片真相迁 R2 Phase 0)。无行 →
        // {uploaded:0,missing:0},让上传面板知道还差多少张原图没落地。
        photoOriginals,
        // 预览垫底背景(相册级);编辑器读它铺画板、导出拼图也读它。null = 无。
        boardBackground: album.boardBackground ?? null,
        photoFilter: album.photoFilter ?? null,
        // 成稿文案来源:'placeholder' = 游客占位样稿(登录后前端检测到它自动补跑真
        // compose)、'ai' = 真文案、null = 未成稿/历史相册。
        copySource: album.copySource ?? null,
        errorMessage: album.errorMessage,
        createdAt: album.createdAt,
      },
      pages: pages.map((p) => ({
        pageIndex: p.pageIndex,
        templateId: p.templateId,
        imagesJson: p.imagesJson,
        textsJson: p.textsJson,
        imagePosJson: p.imagePosJson,
      })),
      generation,
    };
  },

  // Read-only chapter summary for the editor rail. Chapters are the AI's image
  // clusters from the authoring tree (draft_json); we expose only a derived
  // summary (label / role / photoIds) — never the editable tree, so invariant 12
  // holds. Returns [] when there's no draft (e.g. a finalized album).
  async getChapterSummary(userId: string, albumId: string): Promise<{
    chapters: { chapterId: string; label: string; role: string; photoIds: string[]; chapterContext: string }[];
  }> {
    // 协同白名单读路径:编辑器的章节栏对 editor 开放(只暴露派生摘要)。
    const album = (await collaborationService.requireAccess(userId, albumId)).album;
    const normalized = readStoryDraft(album.draftJson);
    if (!normalized) return { chapters: [] };
    const last = normalized.tree.chapters.length - 1;
    return {
      chapters: normalized.tree.chapters.map((ch, i) => ({
        chapterId: ch.chapterId,
        // 章标识优先读 title(分析期确定性派生);老树没有 title,降级 description,
        // 再兜底 `Group N`。
        label: chapterLabel(ch, `Group ${i + 1}`),
        role: i === 0 ? 'opening' : i === last ? 'closing' : 'body',
        photoIds: ch.photos.map((photo) => photo.photoId),
        // 采访门槛读取:该章 chapterContext 非空 ⇔ 已采访过(不变式 12:只读派生字段)。
        chapterContext: ch.chapterContext ?? '',
      })),
    };
  },

  async getInternalAgentData(input: V3InternalAgentDataRequest) {
    const album = await albumRepo.findById(input.albumId);
    if (!album) throw ERRORS.ALBUM_NOT_FOUND();
    // 必须走 loadStoryDraft(rows preferred),不能用只读 draftJson 的 readStoryDraft:
    // draft_pages 拆表后写路径不再把 pages 写回 draftJson(见 envelopeJson 注释),
    // 裸读 draftJson 会让下面三个分支的 pageIndexes 恒空,Design Agent 永远定位不到页。
    const normalized = await loadStoryDraft(album);
    if (!normalized) throw ERRORS.VALIDATION_FAILED('album has no V3 story draft');

    if (input.type === 'page-info') {
      const slice = sliceChapterForChat(normalized, input.chapterId);
      if (!slice) throw ERRORS.VALIDATION_FAILED('chapterId not found in draft');
      const pages =
        input.scope === 'page'
          ? slice.pages.filter((page) => page.pageIndex === input.pageIndex)
          : slice.pages;
      if (input.scope === 'page' && pages.length === 0) {
        throw ERRORS.VALIDATION_FAILED('pageIndex not found in chapter');
      }
      return { type: 'page-info' as const, data: { chapter: slice.chapter, pages } };
    }

    if (input.type === 'chapter-search') {
      const query = input.query.trim().toLowerCase();
      const overviews = buildRecommendOverviews(normalized.tree);
      const matches = overviews
        .map((chapter, i) => {
          const pageIndexes = (normalized.pages ?? [])
            .filter((page) => chapterIdForDraftPage(normalized, page) === chapter.chapterId)
            .map((page) => page.pageIndex);
          // 检索只认内容文字(目录描述 + 照片描述)。章标识(title)是拍摄日期派生的,
          // 进 haystack 会让「2024」这种查询命中全书每一章,所以刻意不收。
          const haystack = [chapter.description, ...chapter.photoDescs].join(' ').toLowerCase();
          const score = haystack.split(query).length - 1;
          return {
            chapterId: chapter.chapterId,
            pageIndexes,
            label: chapterLabel(normalized.tree.chapters[i] ?? {}, chapter.chapterId),
            score,
          };
        })
        .filter((match) => match.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, input.limit);
      return { type: 'chapter-search' as const, data: { matches } };
    }

    if (input.type === 'book-tree') {
      const doneSet = new Set(normalized.progress.doneChapterIds);
      const pages = normalized.pages ?? [];
      const chapters = normalized.tree.chapters.map((chapter, i) => {
        const pageIndexes = pages
          .filter((page) => chapterIdForDraftPage(normalized, page) === chapter.chapterId)
          .map((page) => page.pageIndex);
        return {
          chapterId: chapter.chapterId,
          label: chapterLabel(chapter, chapter.chapterId),
          pageIndexes,
          done: doneSet.has(chapter.chapterId),
        };
      });
      return {
        type: 'book-tree' as const,
        data: {
          progress: normalized.progress,
          ...(input.pageIndex !== undefined ? { focusedPageIndex: input.pageIndex } : {}),
          chapters,
          allDone: chapters.length > 0 && chapters.every((chapter) => chapter.done),
        },
      };
    }

    const chapter = normalized.tree.chapters.find((item) => item.chapterId === input.chapterId);
    if (!chapter) {
      throw ERRORS.VALIDATION_FAILED('chapterId not found in draft');
    }
    const refs = transientPagePhotoRefs.get(input.albumId, input.chapterId);
    const photos = chapter.photos.flatMap((photo) => {
      const ref200px = refs.get(photo.photoId);
      if (ref200px === undefined) return [];
      return [
        {
          photoId: photo.photoId,
          ref200px,
          orientation: photo.orientation,
          ...(photo.takenAt !== undefined ? { takenAt: photo.takenAt } : {}),
        },
      ];
    });
    return { type: 'page-photos' as const, data: { photos } };
  },

  // ② 章节故事完成度(WP2.4 / §4.2(1)). Web is the sole owner of stage + 当前章 +
  // 各章 done (architecture §8.3 stage 推进权在 Web). Returns the editor's gate state:
  // the ordered chapter ids, which are done, the current (not-yet-confirmed) chapter,
  // and whether the export gate is open. `exportUnlocked` keys ONLY off story being
  // fully done (stage advanced past 'story') — theme/cover are NOT gates (§4.5a), so
  // skipping them never blocks export (WP5.2 consumes this). Returns chapters: []
  // when the album isn't a V3 story draft (no draft / finalized) — caller renders no
  // gate.
  async getStoryProgress(userId: string, albumId: string): Promise<{
    stage: string;
    chapterOrder: string[];
    doneChapterIds: string[];
    currentChapterId: string | null;
    allDone: boolean;
    exportUnlocked: boolean;
    // 排版续跑信号(story gate 只读派生,与 story 完成度正交):见 resolveLayoutState。
    // markChapterDone 等其它调用方不透出此字段(它们不触碰排版态),故只在这里追加,
    // storyProgressFrom 保持纯同步不变 —— 侵入最小。
    layoutState: LayoutState;
  }> {
    // 协同授权 seam(collab plan §5.1):owner|editor 都是作者,这条是作者读路径。
    // 曾经用 findOwned —— 与 getDetail 当初迁移的理由完全同一个:协作者能打开相册
    // (getDetail 走 requireAccess),却在这里吃 403,而 ChatPanel 的 catch 把它静默
    // 吞成「闸门未知」,结果是导出按钮永久 disabled、无提示无日志。
    const { album } = await collaborationService.requireAccess(userId, albumId);
    return {
      ...storyProgressFrom(album.stage, readStoryDraft(album.draftJson)),
      layoutState: await resolveLayoutState(albumId),
    };
  },

  // Mark ONE chapter 确定 (done) — the "一章一确定" action (§4.2(1)). Advances the
  // cursor to the next not-done chapter; when EVERY chapter is done it sets the
  // current chapter to null AND advances albums.stage 'story' → 'theme', which opens
  // the export gate (§4.5a). stage ⟂ status: this writes ONLY the stage column +
  // draft_json progress — it never touches status / creditService (§6.8 第 4 条 /
  // 任务硬约束). Idempotent: re-confirming an already-done chapter is a no-op that
  // returns the current state (so a double-click can't double-advance). Only valid
  // while stage='story'; calling it after theme is a no-op (the gate already opened).
  async markChapterDone(
    userId: string,
    albumId: string,
    chapterId: string,
  ): Promise<{
    stage: string;
    chapterOrder: string[];
    doneChapterIds: string[];
    currentChapterId: string | null;
    allDone: boolean;
    exportUnlocked: boolean;
  }> {
    return db.transaction(async (tx) => {
      const album = await albumRepo.findByIdForUpdate(tx, albumId);
      if (!album) throw ERRORS.ALBUM_NOT_FOUND();
      if (album.userId !== userId) throw ERRORS.ALBUM_NOT_OWNED();

      // draft_pages 拆表(Phase 1a):此写点只改 tree/progress,从不需要页数据 —— 直接
      // 解析 envelope(不经 loadStoryDraft,不读/播种 draft_pages),写回同样只重写
      // envelope(envelopeJson,天然不含 pages 键)。不 bump draft_revision:页没变,
      // Phase 1b 的 collab-sync 只关心页变化(计划明文)。
      const envelope = parseDraftEnvelope(album.draftJson);
      if (!envelope) throw ERRORS.VALIDATION_FAILED('album has no V3 story draft');

      const chapterOrder = envelope.tree.chapters.map((c) => c.chapterId);
      if (!chapterOrder.includes(chapterId)) {
        throw ERRORS.VALIDATION_FAILED('chapterId not found in draft');
      }

      // The gate already moved past story → nothing to confirm. Surface the current
      // state so the caller is idempotent and never regresses the stage.
      if (album.stage !== 'story') {
        return storyProgressFrom(album.stage, envelope);
      }

      const doneSet = new Set(envelope.progress.doneChapterIds);
      const currentChapterId = chapterOrder.find((id) => !doneSet.has(id)) ?? null;
      if (!doneSet.has(chapterId) && chapterId !== currentChapterId) {
        throw ERRORS.VALIDATION_FAILED('chapterId is not the current story chapter');
      }

      doneSet.add(chapterId);
      const doneChapterIds = chapterOrder.filter((id) => doneSet.has(id));
      const allDone = chapterOrder.every((id) => doneSet.has(id));
      // Next cursor = first chapter (in tree order) not yet done; null when all done.
      const nextCurrent = chapterOrder.find((id) => !doneSet.has(id)) ?? null;

      // 全局写序无例外(计划 Global Constraints:行锁 → ensureDraftPagesSeeded → …):
      // 这一步本身不碰页,但下面的 envelope-only 覆盖仍会整块重写 draftJson —— 若这本
      // 相册还没被任何行级写点摸过,唯一一份 pages 仍只活在 legacy draftJson.pages 里,
      // 不先播种就直接覆盖会把它连根拔掉(与 job-service.ts 的 append 分支同一个坑,
      // 同一个修法)。返回值不需要:这里不推进 revision,只是确保任何 legacy pages 在
      // 被覆盖前已经安全落到 draft_pages 行;真正播种发生时(0→1)的一次性 revision
      // 前移是播种自身的既定副作用,不是本方法「推进 revision」。
      await ensureDraftPagesSeeded(tx, album);

      await albumRepo.update(tx, albumId, {
        draftJson: envelopeJson({
          tree: envelope.tree,
          progress: { currentChapterId: nextCurrent, doneChapterIds },
          design: envelope.design,
        }),
        // 全章确定 → 进下一环 theme + 解锁导出(§4.2(1) / §4.5a). Only the stage column
        // moves; status stays whatever the init lifecycle left it (EDITING).
        ...(allDone ? { stage: 'theme' as const } : {}),
      });

      return storyProgressFrom(allDone ? 'theme' : album.stage, {
        ...envelope,
        progress: { currentChapterId: nextCurrent, doneChapterIds },
      });
    });
  },

  // ②b 设计 Agent 全书对话（packages/design-agent album server）。每轮先把 draft 的
  // tree+pages 装进 Agent 画布（Web/Postgres 永远是书的真相源），再发对话；Agent 的
  // 写入工具只改它画布里的书，Web 拿回 pages 逐页过 contracts Page strict 校验后
  // 整替 draft_json.pages。读-答轮次（committed=false）不落库。
  async designChatTurn(
    userId: string,
    albumId: string,
    input: { userMessage: string; currentPageIndex?: number },
  ): Promise<{ assistantReply: string; committed: boolean; pageCount: number; warnings: string[] }> {
    const { baseSettingsRevision } = await this.prepareDesignChat(userId, albumId);
    const result = await designAgentClient.chat(albumId, input.userMessage, input.currentPageIndex);
    const applied = await this.persistDesignChat(userId, albumId, {
      userMessage: input.userMessage,
      assistantReply: result.assistantReply,
      committed: result.committed,
      pages: result.book.pages,
      photoFilterPatch: result.photoFilterPatch,
      baseSettingsRevision,
    });
    return {
      assistantReply: result.assistantReply,
      committed: result.committed,
      pageCount: result.book.pages.length,
      // 分享失配一类的告知也要走非流式这条路 —— 两条路径同一口径。
      warnings: applied?.warnings ?? [],
    };
  },

  // 装书前置：所有权校验 + draft 校验 + 把当前书推给设计 Agent。流式与同步两条
  // 路径共用。
  // 返回本轮的设置基线(装书那一刻的 settingsRevision)。落库时带上它,
  // OCC 才横跨整轮 —— 与 AI 长任务派发时记 baseline、回写前重验同一套路数。
  async prepareDesignChat(userId: string, albumId: string): Promise<{ baseSettingsRevision: number }> {
    const { album } = await collaborationService.requireAccess(userId, albumId);
    // 行读(同 getDraftSkeleton,2026-08-03 线上事故):否则设计 Agent 装的是 legacy
    // 陈旧书,commit 回写时 replaceAll 会用陈旧页覆盖用户在编辑器里的行级编辑。
    const normalized = await loadStoryDraft(album, { bake: true });
    if (!normalized) throw ERRORS.VALIDATION_FAILED('album has no V3 story draft');
    if (!normalized.pages || normalized.pages.length === 0) {
      throw ERRORS.VALIDATION_FAILED('album has no layout pages yet');
    }
    // 书级设计简报:AI 的全局语境四件套之三(主题/配色主题/封面氛围;第四件=每页
    // 内容本身)。chapter 概念不进 AI 上下文 —— chapters 仍随书传(照片池校验用)。
    const design = (album.draftJson as { design?: { fonts?: Record<string, string>; colors?: Record<string, string> } } | null)
      ?.design;
    const coverPage = normalized.pages.find((p) => templateCategory(p.templateId) === 'cover');
    const coverMood = coverPage
      ? Object.entries(coverPage.texts)
          .filter(([key, value]) => !key.includes('#') && value)
          .slice(0, 3)
          .map(([, value]) => value)
          .join(' / ')
          .slice(0, 120)
      : '';
    // 照片三件套的输入(2026-09-09):
    //  · photoFilter —— 全书调色/抠图现状,Agent 读它判断当前调性;改动经由
    //    /api/chat 响应的 photoFilterPatch 带回,由 persistDesignChat 落库。
    //  · hasPublishedShare —— 为真时 Agent 改滤镜要提醒用户重新备份全书
    //    (share-service 拿 effectiveRenderVersion 精确核对备份快照)。
    //  · viewablePhotoIds —— look_at_photos 取得到字节的那批。只传 id 不传图:
    //    一本书几十张,base64 全塞进装书请求太贵,而看图是兜底路径。
    //  · profiles —— 照片视觉档案。**在这里合进载荷,不进 draft_json**:
    //    `V3ChapterPhoto` 是 `.strict()` 且没有 profile 字段,塞进树里整棵树会 parse
    //    失败。design-agent 的 `AlbumChapterPhoto.profile` 就是给这一步准备的。
    //    没建档的照片不带这个键(而不是带一个空档案)—— 读取方一律要能降级。
    const [hasPublishedShare, photoRows, profiles] = await Promise.all([
      albumShareRepo.existsByAlbum(albumId),
      albumPhotoRepo.findByAlbum(albumId),
      getPhotoProfiles(albumId),
    ]);
    await designAgentClient.loadBook(
      albumId,
      {
        chapters: withPhotoProfiles(normalized.tree.chapters, profiles),
        pages: normalized.pages,
        brief: {
          theme: [album.title, album.prompt].filter(Boolean).join(' — ').slice(0, 200) || undefined,
          ...(design ? { palette: { fonts: design.fonts, colors: design.colors } } : {}),
          ...(coverMood ? { coverMood } : {}),
        },
        photoFilter: album.photoFilter ?? null,
      },
      {
        hasPublishedShare,
        viewablePhotoIds: photoRows.filter((row) => row.status === 'uploaded').map((row) => row.photoId),
      },
    );
    return { baseSettingsRevision: album.settingsRevision };
  },

  // 对话结果落库：committed 时 pages 逐页过 contracts Page strict 后事务写回
  // draft_json；聊天历史进 album_messages（与 chapter-chat 同表，design chat 全书
  // 视角不挂 chapterId）。
  async persistDesignChat(
    userId: string,
    albumId: string,
    input: {
      userMessage: string;
      assistantReply: string;
      committed: boolean;
      pages: unknown[];
      ops?: Array<{ toolName: string; input: unknown }>;
      /** design-agent 本轮累计的滤镜/抠图 patch;没动过传 null/省略。 */
      photoFilterPatch?: Record<string, unknown> | null;
      /** 装书那一刻的 settingsRevision(prepareDesignChat 返回)。**必须带** ——
       * 不带的话 lockAlbumForSettingsWrite 会把协作者(editor)一律拒掉,
       * 协作者用设计对话调色每次必失败。 */
      baseSettingsRevision?: number;
    },
    // 返回落库后的权威滤镜状态(归一化过、与并发写合并过),供路由回发浏览器
    // 原地重绘 —— 滤镜引擎只在 Browser 跑,画板不知道新值就还是旧观感。
    // 没写滤镜时返回 null。
    //
    // warnings:分享快照失配一类的告知(applyAgentPhotoFilter 算的)。**必须一路
    // 送到用户眼前** —— design-agent 那侧工具 `terminate: true` 会掐断 agent 循环,
    // 模型没机会把 notes 转述出来;失败场景是真的:已发布分享的书被整本改色 →
    // 全书 renderVersion 变 → 分享页照片全糊、要重备全书,而用户全程零提示。
  ): Promise<{
    photoFilter: PhotoFilterState | null;
    settingsRevision: number;
    warnings: string[];
  } | null> {
    if (input.committed) {
      // 数组序是唯一真相,pageIndex 按位置重编号(0..n-1)。design-agent 的写工具
      // (move_pages;delete_page 同理)只动数组顺序、不改页对象的 pageIndex 字段
      // (album-move-pages-tool.test.ts 锁死逐字节不变)—— 拆表前 draftJson.pages
      // 靠数组顺序天然承载页序,拆表后 replaceAll 按 page.pageIndex 落行、读回按
      // pageIndex 排序,不重编号的话挪页/删页会在落库时被旧 pageIndex 静默还原。
      // 行级世界的一致性不变式也要求它:updatePage 按数组下标取页、按 pageIndex
      // 定位行,二者必须相等且连续。
      const pages = input.pages.map((page, i) => ({ ...Page.parse(page), pageIndex: i }));
      await db.transaction(async (tx) => {
        const latest = await albumRepo.findByIdForUpdate(tx, albumId);
        if (!latest) throw ERRORS.ALBUM_NOT_FOUND();

        // draft_pages 拆表(Phase 1a)固定写事务次序,同 T3/T4/T5:行锁(above)→
        // 懒播种 → 用锁内 draftJson 的 envelope(tree/progress/design)—— design
        // chat 每轮由 Agent 整书回放全部 pages(move_pages 会增删页,不是逐页
        // patch),这里从来不需要旧 pages 内容,只需要「有没有草稿」这个门禁和
        // envelope 三件套用于重写 draftJson,所以直接解 envelope 而不是绕
        // loadStoryDraft 多读一次 draft_pages/legacy pages。
        const seededRevision = await ensureDraftPagesSeeded(tx, latest);
        const envelope = parseDraftEnvelope(latest.draftJson);
        if (!envelope) throw ERRORS.VALIDATION_FAILED('album has no V3 story draft pages');

        const rev = await bumpDraftRevision(tx, albumId, seededRevision, { structural: true });
        await draftPageRepo.replaceAll(tx, albumId, pages, rev, userId);

        // 编辑一本已 COMPLETED 的书 → 退回 EDITING(photo-snapshot §5.5,同
        // updatePage/reorderPages):导出即完成、但不锁编辑;一旦改动,旧 PDF 不
        // 再代表当前内容,状态回 EDITING。pdfUrl 保留。envelope-only 重写:页真
        // 相已迁 draft_pages,draftJson 只剩 {tree, progress, design}(锁内最新
        // 值,design chat 没有动 tree/progress)。pageCount 收口点三:
        // move_pages 会增删页,必须显式跟 pages.length(此前这里遗漏)。
        // draft.design 与页面真相对账(2026-08-29 最终评审 Critical 1):设计 Agent 的
        // apply_book_style 整本换风格时只改 pages,这里若把 design 原样搬回去,
        // draft.design 就成了陈旧状态 —— 而追加照片那条路(mergeAppendLayoutPages /
        // mergeAppendComposeTexts)正是按它的 coverColorway/interiorSeed/pageBackground
        // 给新页派色的,于是「刷成纯白的书里插进一页深红」「刷成多巴胺的书里插进一页
        // 白底浅字(1.06:1)」。reconcileDraftDesign 是自证式的:现状解释得了页面就
        // 原样返回同一个对象(老书零改写),解释不了且能自证出新状态才改写。
        const design = reconcileDraftDesign(envelope.design, pages);
        await albumRepo.update(tx, albumId, {
          draftJson: envelopeJson({ tree: envelope.tree, progress: envelope.progress, design }),
          pageCount: pages.length,
          ...(latest.status === 'COMPLETED' ? { status: 'EDITING' as const } : {}),
        });
      });
    }

    // 滤镜/抠图**独立于 committed** 落库:它写的是 albums.photo_filter(走
    // settingsRevision 那套 OCC),不进 draft_pages 的 version —— 一轮只调色不改
    // 版面的对话 committed 是 false,拿 committed 当闸门会让调色永远存不下来。
    // 复用 applyAgentPhotoFilter 而不是在这里自己写:那边的 lockAlbumForSettingsWrite
    // 四步(行锁 / 锁内 resolveRole / 基线校验 / settingsRevision 比较)是协同 OCC 的
    // 防线,绕开一步就是并发脏写。
    //
    // baseSettingsRevision 来自 prepareDesignChat(装书那一刻读的),横跨整轮 ——
    // 对话期间另一端改过设置就失配 409、零写入,让用户重来。这不是「写之前现读」
    // 那种假 OCC。**必须带**:lockAlbumForSettingsWrite 的过渡口径是「owner 省略走
    // 旧盲写,editor 省略一律拒绝」,漏传会让协作者用设计对话调色每次必失败。
    //
    // 写序:页面 → 滤镜 → 聊天记录。滤镜失配时聊天记录不落 —— 宁可让用户看见报错
    // 重来,也不能留一条「已经调成旅行大片」的回复而实际没改(静默撒谎)。两套 OCC
    // 跨不了同一个事务,这个次序是权衡后的取舍,别随手调换。
    let applied: {
      photoFilter: PhotoFilterState | null;
      settingsRevision: number;
      warnings: string[];
    } | null = null;
    if (input.photoFilterPatch) {
      const result = await applyAgentPhotoFilter(
        userId,
        albumId,
        input.photoFilterPatch,
        input.baseSettingsRevision,
      );
      applied = {
        photoFilter: result.photoFilter,
        settingsRevision: result.settingsRevision,
        warnings: result.warnings,
      };

      // 这一轮开了抠图的照片,顺手把**服务端分割 mask** 备好(写 R2 + 回填
      // profile.maskKey)。不备的话渲染只能退回浏览器端的漫水填充 —— 那正是
      // 2026-08-29 验证「棚拍人像 5 张 0 张能用」而被否决的那套,用户会拿到一个
      // 被啃残的自己。
      //
      // **尽力而为,绝不让它拖垮这一轮**:滤镜/抠图开关此刻已经落库了,mask 只影响
      // 抠得好不好。ensureCutoutMasks 自己吞异常,这里再兜一层是防它将来改坏。
      // 没跑成的下一轮会自己补(判据是「开着抠图但还没 maskKey」)。
      const turnedOn = Object.entries(
        (input.photoFilterPatch as { cutouts?: Record<string, unknown> }).cutouts ?? {},
      )
        .filter(([, on]) => on === true)
        .map(([photoId]) => photoId);
      if (turnedOn.length > 0) {
        try {
          await photoMaskService.ensureCutoutMasks(albumId, turnedOn);
        } catch (error) {
          logger.warn({ albumId, err: String(error) }, 'cutout mask prep failed; browser fallback stands');
        }
      }
    }

    await db.transaction(async (tx) => {
      if (input.userMessage.trim()) {
        await albumMessageRepo.create(tx, {
          albumId,
          userId,
          role: 'user',
          content: input.userMessage,
        });
      }
      await albumMessageRepo.create(tx, {
        albumId,
        userId,
        role: 'assistant',
        content: input.assistantReply,
        // 写类操作摘要存进 layout_patch（design chat 专用形状），供历史回放重建 op-card。
        layoutPatch: input.ops && input.ops.length > 0 ? { designOps: input.ops } : null,
      });
    });

    return applied;
  },

  // 内容采集(分组后采访)— 把每章的 chapterContext 写进 draft_json.tree(§3 数据归属:Web 是
  // draft_json 唯一真相源,浏览器只发它的答案)。chapterContext 是**树字段**(章节背景,给排版/
  // 写文案读),不是页级文字,所以写进 tree.chapters[].chapterContext,不碰 pages。
  // 不推进 stage、不调 Agent:采访只补充章节背景,排版由浏览器随后照常触发(select-layout)。
  // 可跳过:未提交的章保持 chapterContext=""(default),不挡流程。幂等:重复提交只覆盖同章。
  async saveChapterContexts(
    userId: string,
    albumId: string,
    contexts: { chapterId: string; chapterContext: string; place?: string }[],
    // 采访问答也存进 album_messages(带 chapterId),loadHistory 才能在刷新/重进后重建对话
    // 历史(否则收集环节的 AI 问 + 用户答只在 DOM,刷新即失)。可选:跳过采访不传 messages。
    messages?: { chapterId: string; role: 'user' | 'assistant'; content: string }[],
  ): Promise<{ savedChapterIds: string[] }> {
    // draft_pages 拆表(Phase 1a)修复:此前用 findOwned(无锁)在事务外读 album,
    // 再在一个独立事务里整块重写 draftJson(顺带把当时读到的 pages 原样搬运回去)
    // —— 无锁 + 事务外读改写窗口,且徒手搬运页数据。现在行锁 + 锁内读 envelope
    // (parseDraftEnvelope,不需要页数据,不经 loadStoryDraft)→ 改 tree →
    // ensureDraftPagesSeeded(全局写序无例外,见下方调用点注释)→ envelope-only 重写
    // (envelopeJson,天然不含 pages 键)。不 bump draft_revision、不做行级写:页没变,
    // Phase 1b 的 collab-sync 只关心页变化(计划明文)。
    return db.transaction(async (tx) => {
      const album = await albumRepo.findByIdForUpdate(tx, albumId);
      if (!album) throw ERRORS.ALBUM_NOT_FOUND();
      if (album.userId !== userId) throw ERRORS.ALBUM_NOT_OWNED();

      const envelope = parseDraftEnvelope(album.draftJson);
      if (!envelope) throw ERRORS.VALIDATION_FAILED('album has no V3 story draft');

      const expectedIds = new Set(envelope.tree.chapters.map((ch) => ch.chapterId));
      const seen = new Set<string>();
      const byId = new Map<string, { chapterContext: string; place?: string }>();
      for (const entry of contexts) {
        if (!expectedIds.has(entry.chapterId)) {
          throw ERRORS.VALIDATION_FAILED('chapterId not found in draft');
        }
        if (seen.has(entry.chapterId)) {
          throw ERRORS.VALIDATION_FAILED('duplicate chapterId in chapter contexts');
        }
        seen.add(entry.chapterId);
        // 裁到 500(与 V3Chapter.chapterContext 上限对齐);空串合法(=该章跳过采访)。
        // place 是城市级地名文字(V3Chapter.place,§3:坐标不出浏览器,地名文字可出),
        // 裁到 100;未传 = 不改该章现有 place。
        byId.set(entry.chapterId, {
          chapterContext: entry.chapterContext.slice(0, 500),
          ...(entry.place !== undefined ? { place: entry.place.slice(0, 100) } : {}),
        });
      }

      const nextTree: typeof envelope.tree = {
        chapters: envelope.tree.chapters.map((ch) => {
          const update = byId.get(ch.chapterId);
          if (update === undefined) return ch;
          return {
            ...ch,
            chapterContext: update.chapterContext,
            ...(update.place !== undefined ? { place: update.place } : {}),
          };
        }),
      };

      // 全局写序无例外(计划 Global Constraints:行锁 → ensureDraftPagesSeeded → …):
      // 这一步不碰页,但下面的 envelope-only 覆盖仍会整块重写 draftJson —— 这个写点
      // 在「加照片后再采访」链路上真实可达(ChatPanel waitForAppendChapters →
      // finishInterview → POST /chapter-context),若这本相册的页此时仍只活在 legacy
      // draftJson.pages 里(还没被任何行级写点摸过),不先播种就直接覆盖会把它连根
      // 拔掉。返回值不需要:这里不推进 revision、不做任何行级写,只是确保 legacy
      // pages 在被覆盖前已经安全落到 draft_pages 行;播种自身首次触发(0→1)的一次性
      // revision 前移是它的既定副作用,不是本方法「推进 revision」。
      await ensureDraftPagesSeeded(tx, album);

      await albumRepo.update(tx, albumId, {
        draftJson: envelopeJson({ tree: nextTree, progress: envelope.progress, design: envelope.design }),
      });

      // 采访问答进 album_messages(带 chapterId),供 loadHistory 按 seq 顺序重建。只存该章存在
      // 的消息。顺序由 repo.create 分配的单调 seq 保证(写入顺序 = 回放顺序),不再手工错开
      // createdAt —— 「问1→问2→问3→答」按这里的循环顺序落库即可。原样未动(§brief 第二部分)。
      for (const m of messages ?? []) {
        const content = m.content.trim();
        if (!content || !expectedIds.has(m.chapterId)) continue;
        await albumMessageRepo.create(tx, {
          albumId,
          userId,
          chapterId: m.chapterId,
          role: m.role,
          content: content.slice(0, 2000),
        });
      }

      return { savedChapterIds: [...seen] };
    });
  },

  // Read-only RENDER projection of the V3 authoring tree (draft_json) for the
  // editor skeleton preview. Unlike getChapterSummary this
  // includes pages (templateId/images/texts) because the skeleton must show the
  // actual layout — but it stays consistent with invariant 12: this is a one-way
  // READ for rendering only; the tree is NEVER edited in the browser and never
  // round-trips back. Edits go through theme/chapter-chat, which re-slice
  // draft_json server-side. Returns null when there's no draft to render (not in
  // the draft phase, or already finalized — layout_json set).
  //
  // Pages are flattened into one ordered, re-indexed list (cover → toc? →
  // chapter pages in order → ending) so the browser renderer/flipbook can address
  // them sequentially; each chapter carries the [pageStart, pageEnd) slice into
  // that list. The browser only ever sends a chapterId back (chapter-chat), so the
  // original per-page indexes are deliberately dropped.
  async getDraftSkeleton(userId: string, albumId: string) {
    // 协同白名单读路径:editor 也要能拉草稿投影(skeleton 只含渲染数据,不含
    // 可编辑 authoring tree,invariant 12 保持)。
    const access = await collaborationService.requireAccess(userId, albumId);
    const album = access.album;
    // 时序反转:排版前(analyze 完、还没 select-layout)也要能拿 skeleton 去走「收集故事」面板。
    // 那时 album.status='EDITING'(analyze 完成后保持 EDITING,不翻 AGENT_RUNNING)、layoutJson=null、
    // draftJson 有 tree 无 pages。status 允许 EDITING/AGENT_RUNNING(后者兼容老时序)以及
    // COMPLETED(V3 导出 PDF 只把 status 标 COMPLETED,layoutJson 仍为 null、页面仍只在 draft_json——
    // 导出后重新打开必须仍能渲染草稿,否则书「消失」)。layoutJson 才是草稿↔定稿的真判据:
    // 仍必须为 null(排版完/定稿走另一路)。
    if (
      (album.status !== 'EDITING' &&
        album.status !== 'AGENT_RUNNING' &&
        album.status !== 'COMPLETED') ||
      album.layoutJson
    )
      return null;
    // draft_pages 拆表:页真相在行级表,这里必须行读(loadStoryDraft 行优先、无行才
    // 回退 legacy)。2026-08-03 线上事故:写点(T3-T5)已切行、这里还读 legacy
    // draftJson.pages,用户的编辑「保存成功但刷新消失」。bake:true 保持原
    // readStoryDraft 的兜底烘制语义(skeleton 对外带 htmlJson)。
    const normalized = await loadStoryDraft(album, { bake: true });
    if (!normalized) return null;
    // 排版前 pages 尚不存在 —— 用空数组,chapters 仍从 tree 出(带 photoIds),让收集面板可用。
    const draftPages = normalized.pages ?? [];
    // 协同增量同步(collab plan §7.3):每页带 version/updatedBy/updatedAt —— 客户端
    // 保存时作为 OCC baseVersion,轮询时作为 since 初值。排版前无行 → null。
    //
    // meta 必须来自**上面那次 loadStoryDraft 的同一次读**,不能为了拿版本号再查一遍
    // draft_pages:两次读之间落一次写,客户端就会拿到「旧内容 + 新 version」,带着它
    // 保存时预比较与条件更新都会放行 —— 静默覆盖掉一份它从未见过的修改,正是 OCC
    // 要防的那件事被读路径自己捅穿。
    const rowByPageIndex = normalized.meta;

    const chapterIdForPage = (page: V3Page): string | null => {
      const refs = new Set(Object.values(page.images));
      const match = normalized.tree.chapters.find((chapter) =>
        chapter.photos.some((photo) => refs.has(photo.photoId)),
      );
      return match?.chapterId ?? null;
    };

    const pages = draftPages.map((p, i) => {
      const category = getTemplate(p.templateId)?.category;
      const kind =
        category === 'cover'
          ? 'cover' as const
          : category === 'toc'
            ? 'toc' as const
            : category === 'ending'
              ? 'ending' as const
              : 'chapter' as const;
      return {
        pageIndex: i,
        templateId: p.templateId,
        imagesJson: p.images,
        textsJson: p.texts,
        imagePosJson: p.imagePos ?? {},
        // 页面 HTML 真相(C 方案):readStoryDraft 已兜底烘制,画板优先渲染它。
        htmlJson: (p as { html?: string }).html,
        kind,
        chapterId: kind === 'chapter' ? chapterIdForPage(p) : null,
        // 协同元数据(collab plan §7.3):按页对象的 pageIndex 字段对行,不是数组位。
        version: rowByPageIndex.get(p.pageIndex)?.version ?? null,
        updatedBy: rowByPageIndex.get(p.pageIndex)?.updatedBy ?? null,
        updatedAt: rowByPageIndex.get(p.pageIndex)?.updatedAt.toISOString() ?? null,
      };
    });

    const chapters = normalized.tree.chapters.map((ch, i) => {
      const pageIndexes = pages
        .map((page, idx) => (page.chapterId === ch.chapterId ? idx : -1))
        .filter((idx) => idx >= 0);
      const fallbackStart = Math.min(i + 1, Math.max(pages.length - 1, 0));
      const pageStart = pageIndexes[0] ?? fallbackStart;
      const pageEnd =
        pageIndexes.length > 0
          ? pageIndexes[pageIndexes.length - 1]! + 1
          : Math.min(pageStart + 1, pages.length);
      // The chapter title may be persisted into an empty title slot at apply-theme (#236).
      // Surface it from the first of this chapter's pages that carries a `title` role slot
      // value, so the chapter card / rail can show it.
      const subject = titleOfChapterPages(
        pageIndexes.map((idx) => draftPages[idx]!),
      );
      return {
        chapterId: ch.chapterId,
        // 章标识优先用树上的确定性 title(分析期按拍摄时间跨度派生),老树无此键降级
        // description,都空才 `Group N` —— 与 getChapterSummary 同一条降级链。
        label: chapterLabel(ch, `Group ${i + 1}`),
        ...(subject ? { subject } : {}),
        role:
          i === 0
            ? 'opening' as const
            : i === normalized.tree.chapters.length - 1
              ? 'closing' as const
              : 'body' as const,
        state: 'generated' as const,
        askCount: 0,
        pageStart,
        pageEnd,
        // 章节的照片直接从 tree 取 —— 排版前 pages 不存在,收集面板的章节卡片靠这个显示缩略图。
        photoIds: ch.photos.map((p) => p.photoId),
      };
    });

    return {
      theme: null,
      style: 'v3',
      language: 'en' as const,
      pages,
      chapters,
      // 协同(collab plan §7.3):全书 revision(轮询 since 初值)+ 调用者角色
      // (前端据此隐藏 owner-only 入口;权限仍由后端兜底)。
      revision: album.draftRevision,
      // 结构 OCC 基线(Phase 2A):reorder/delete 提交的 baseStructureRevision。
      // 与 draftRevision 刻意分离 —— 结构版本只在结构写点推进,不能拿
      // draftRevision 冒充(否则单页写也会让重排/删页误判冲突)。
      structureRevision: album.draftStructureRevision,
      // 全局创作设置 OCC 基线(Phase 2B):与 getDetail 同口径。
      settingsRevision: album.settingsRevision,
      role: access.role,
    };
  },

  // 没有真正封面页(album_pages 未定稿)也没有已存缩略图时,从草稿里挑一组
  // "项目里的照片" id 给 my-albums 卡片兜底:优先草稿已排版页的图槽(更贴近成品),
  // 其次章节相簿原图顺序。浏览器侧从 photoStore 逐个解析,第一张解得出来的当封面
  // 缩略图上传 —— 卡片不再是空报刊。只传 id,不碰图像数据(原图只在浏览器)。
  fallbackCoverPhotoIds(draftJson: unknown, cap = 8): string[] {
    if (!draftJson || typeof draftJson !== 'object') return [];
    const root = draftJson as {
      tree?: { chapters?: unknown };
      chapters?: unknown;
      pages?: unknown;
    };
    const ids: string[] = [];
    const seen = new Set<string>();
    const push = (value: unknown) => {
      if (typeof value === 'string' && value && !seen.has(value) && ids.length < cap) {
        seen.add(value);
        ids.push(value);
      }
    };
    if (Array.isArray(root.pages)) {
      for (const page of root.pages) {
        const images = (page as { images?: unknown })?.images;
        if (images && typeof images === 'object') {
          for (const v of Object.values(images as Record<string, unknown>)) push(v);
        }
        if (ids.length >= cap) return ids;
      }
    }
    const chapters = root.tree?.chapters ?? root.chapters;
    if (Array.isArray(chapters)) {
      for (const chapter of chapters) {
        const photos = (chapter as { photos?: unknown })?.photos;
        if (!Array.isArray(photos)) continue;
        for (const photo of photos) push((photo as { photoId?: unknown })?.photoId);
        if (ids.length >= cap) return ids;
      }
    }
    return ids;
  },

  async listByUser(userId: string) {
    const rows = await albumRepo.findByUser(userId);
    // 共享相册(collab rework §15.2):我作为 editor 被邀请的书也进列表。
    // 两查询天然不重叠(owner 不在 members 表);role 供前端区分展示与治理入口
    // (editor 无 deleteAlbum,列表删除按钮须按 role 隐藏)。
    // 排序保持存量行为:自己的书按 createdAt desc(老用户列表顺序不变),
    // 共享书整段追加在尾部(按加入时间 desc)—— 不悄悄改变既有用户的列表顺序。
    const sharedRows = await albumRepo.findSharedWithUser(userId);
    // role 不硬编码:共享书同样走 resolveRole 统一判定(与 owner 书同一权限
    // 真相;members 表行 → editor,若未来 members 语义扩展只改一处)。
    const shared: Array<{ album: Album; role: 'owner' | 'editor' }> = [];
    for (const { album } of sharedRows) {
      const sharedRole = await resolveRole(album, userId);
      if (!sharedRole) continue; // 成员行在读取间隙被移除:跳过,不下发
      shared.push({ album, role: sharedRole });
    }
    // 去重防御:按 albumId 归一(own 优先)—— 正常数据两查询不重叠,这里只防脏数据。
    const seen = new Set<string>();
    const all: Array<{ album: Album; role: 'owner' | 'editor' }> = [];
    for (const entry of [
      ...rows.map((album) => ({ album, role: 'owner' as const })),
      ...shared,
    ]) {
      if (seen.has(entry.album.id)) continue;
      seen.add(entry.album.id);
      all.push(entry);
    }
    const coverRows = await albumPageRepo.findFirstByAlbumIds(all.map((e) => e.album.id));
    const coverByAlbumId = new Map(
      coverRows.map((p) => [
        p.albumId,
        {
          pageIndex: p.pageIndex,
          templateId: p.templateId,
          imagesJson: p.imagesJson as Record<string, string>,
          textsJson: p.textsJson as Record<string, string>,
          imagePosJson: (p.imagePosJson ?? {}) as Record<string, ImagePos>,
        } satisfies AlbumCoverPage,
      ]),
    );
    // Sweep any zombie on the list path too: landing on /my-albums alone is
    // enough to flip a dead generation to FAILED and release its credit hold.
    const out = [];
    for (const { album: a, role } of all) {
      let status = a.status;
      // sweep 只对**自己的书**做:账务(hold 释放/僵尸结算)归书的 owner,
      // editor 打开列表不触发他人账务。共享书的账务由 owner 打开自己的列表
      // 驱动,不会缺席。
      if (role === 'owner' && status === 'AGENT_RUNNING') {
        const resolved = await jobService.resolveGeneration(a.id);
        // A swept zombie is no longer AGENT_RUNNING, so reload instead of relying
        // on the stale list row.
        if (resolved?.kind === 'swept') {
          const reloaded = await albumRepo.findById(a.id);
          status = reloaded?.status ?? status;
        }
      } else if (role === 'owner' && status === 'EDITING') {
        // Read-time draft-expiry sweep (§12): landing on /my-albums is enough to
        // release an idle draft's hold past 24h. The album stays EDITING (the
        // draft is kept), so status is unaffected — only the credit hold moves.
        await draftExpirySweeper.sweepAlbumOnRead(a.id);
      }
      const coverPage = coverByAlbumId.get(a.id) ?? null;
      out.push(toMyAlbumListItem(a, role, status, coverPage));
    }
    return out;
  },

  // 设计环节 phase 0:封面组选项(规则生成,零 AI)。designed=draft 里已有 cover 页
  // (幂等重入信号,ChatPanel 据此不再重复弹选择卡)。
  async listCoverSets(userId: string, albumId: string) {
    // 同上:作者读路径走协同 seam。协作者列不出封面组 → 选不了封面 → stage 永远
    // 到不了 ready → 导出闸门同样开不了。
    const { album } = await collaborationService.requireAccess(userId, albumId);
    // 页/树源走 loadStoryDraft 行读(applyDesign/composeAppend 同款修法):draft_pages 拆表后
    // envelopeJson 从不把 pages 写回 draftJson,裸读 draftJson.pages 对行存书必空 ——
    // hasPages:false 让前端静默不弹封面选择卡,书永远选不了封面、导不了出。
    const draft = await loadStoryDraft(album, { bake: false });
    const chapters = Array.isArray((draft?.tree as { chapters?: unknown } | undefined)?.chapters)
      ? ((draft!.tree as { chapters: unknown[] }).chapters as Array<{
          photos?: Array<{ photoId: string; composition?: string | null }>;
        }>)
      : [];
    const rawPages: Page[] = draft?.pages ?? [];
    const designed = rawPages.some((page) => templateCategory(page.templateId) === 'cover');
    const latestCompose = await agentJobRepo.findLatestComposeByAlbum(albumId);
    // COMPLETED 不等于「真写出来了」:整章掉队时 pagesTexts 全空也是 COMPLETED(回调回执
    // 诚实,但没有这个字段轮询侧只看得到 status)。writtenPages 是回调完成时回填进
    // job.meta.composeAppend 的实际合并页数(已按 F1 的章归属守卫过滤)——非追加单或
    // 追加单还没回填(未完成)一律 null,只有确定完成后才是 true/false。
    const latestComposeAppendMeta = readComposeAppendMeta(latestCompose?.meta);
    const lastComposeWrote =
      latestComposeAppendMeta?.writtenPages !== undefined
        ? latestComposeAppendMeta.writtenPages > 0
        : null;
    return {
      sets: buildCoverSets(albumId, chapters.map((c) => ({ photos: c.photos ?? [] }))),
      designed,
      hasPages: rawPages.length > 0,
      // 成稿在跑(异步 compose job 未回调):前端别再弹选择卡,直接进轮询等这一单。
      composing: latestCompose?.status === 'QUEUED' || latestCompose?.status === 'RUNNING',
      // 追加范围成稿的完成信号:前端轮询它从 RUNNING 走到 COMPLETED/FAILED。
      lastComposeStatus: latestCompose?.status ?? null,
      // 追加范围成稿是否真写出了页(见上);非追加单/还未回填 → null。
      lastComposeWrote,
      // AI 结果过期(collab rework Phase 4):job 因运行期间的人工修改被拦,
      // 前端据此给出「基于最新版本重跑」的明确行动,而非笼统失败。
      lastComposeStale:
        latestCompose?.status === 'FAILED'
        && (latestCompose?.error as { code?: string } | null)?.code === 'AI_RESULT_STALE',
    };
  },

  // 设计环节:用户在对话框选定封面组后调用。**异步派发**一次性成稿(/v3/compose):
  // Agent 按章并发让 Gemini 看真实照片 + 读用户讲的故事写满全书文案 + 封面/封尾文案 +
  // 字体,几十秒起,同步接口撑不住 —— 这里只校验 + 建 kind='compose' 的 job + 提交,
  // 立即返回;组页落库与 stage='ready' 由回调侧 jobService.handleV3ComposeCompleted 统一做。
  // 幂等:(album,'compose') 活跃唯一索引挡住重复派发,回调侧重入会先剔旧 cover/ending。
  async applyDesign(
    userId: string,
    albumId: string,
    input: {
      language: 'zh' | 'en';
      coverTemplateId: string;
      coverPhotoId: string;
      endingTemplateId: string;
      endingPhotoId: string;
      // 书页底色(4 色之一,可选;纯白/不传 = 不写,留模板默认)。
      pageBackground?: string;
      // 第三套(深色椭圆)选中的配色 id,可选;合法性见下方校验。
      coverColorway?: string;
      // 浏览器本地的 200px 缩略图(photoId → data URL):compose 让模型**看真实照片**
      // 写文案,原图只在浏览器,故与 select-layout 同样由前端随请求带上。
      refs?: Record<string, string>;
    },
  ): Promise<{ requestId: string; accepted: true }> {
    // Creator 授权(collab rework Phase 4):owner/editor 都可发起成稿;
    // AI 继承发起者身份(§2.2),计费 hold 也挂在发起者名下。
    const { album } = await collaborationService.requireAccess(userId, albumId);
    if (album.status !== 'EDITING') throw ERRORS.ALBUM_NOT_EDITABLE();
    if (templateCategory(input.coverTemplateId) !== 'cover')
      throw ERRORS.VALIDATION_FAILED(`not a cover template: ${input.coverTemplateId}`);
    if (templateCategory(input.endingTemplateId) !== 'ending')
      throw ERRORS.VALIDATION_FAILED(`not an ending template: ${input.endingTemplateId}`);
    if (input.pageBackground && !isValidPageBackground(input.pageBackground))
      throw ERRORS.VALIDATION_FAILED(`invalid page background: ${input.pageBackground}`);
    if (input.coverColorway && !coverColorwayById(input.coverColorway))
      throw ERRORS.VALIDATION_FAILED(`invalid cover colorway: ${input.coverColorway}`);

    // 页/树源走 loadStoryDraft 行读:draft_pages 拆表后 envelopeJson 从不把 pages 写回
    // draftJson,新相册排版完 draftJson.pages 就是空的 —— 拆表前这里裸读 draftJson.pages
    // 是「陈旧快照」问题,拆表后直接是「必空」问题(composeAppend 已同款修过)。
    const draft = await loadStoryDraft(album, { bake: false });
    const chapters = Array.isArray((draft?.tree as { chapters?: unknown } | undefined)?.chapters)
      ? ((draft!.tree as { chapters: unknown[] }).chapters as Array<{
          chapterId?: string;
          title?: string;
          chapterContext?: string;
          place?: string;
          photos?: Array<{ photoId: string; takenAt?: string | null }>;
        }>)
      : [];
    const rawPages: Page[] = draft?.pages ?? [];
    if (rawPages.length === 0) throw ERRORS.VALIDATION_FAILED('design requires laid-out pages');

    // 游客升级计费:占位成稿的书,真文案首跑在此收钱(匿名期 analyze 没扣过)。
    // 普通相册 copySource 为 null/'ai',不重复计费。hold 挂在下方 job 事务里,
    // settle 在 compose 完成回调,失败/僵尸由 handleV3Failed/sweeper 释放。
    const upgradeAmount = album.copySource === 'placeholder'
      ? creditService.cost(album.photoCount)
      : 0;
    if (upgradeAmount > 0) await creditService.precheck(userId, upgradeAmount);
    const treePhotoIds = new Set(
      chapters.flatMap((c) => (c.photos ?? []).map((p) => p.photoId)),
    );
    if (!treePhotoIds.has(input.coverPhotoId) || !treePhotoIds.has(input.endingPhotoId))
      throw ERRORS.VALIDATION_FAILED('cover/ending photo not in this album');

    // 送进 compose 的只有内页(封面/封尾文案走 coverSlots/endingSlots 单独出)。
    const interiorPages = rawPages.filter(
      (page) => templateCategory(page.templateId) === 'interior',
    );

    // 封底可能有多个图槽(mag-22 两图):hero 池按构图排序取前 4,剔除封面/封尾主图后补槽。
    const extraEndingPhotoIds = pickHeroPhotos(
      chapters.map((c) => ({ photos: (c.photos ?? []) as { photoId: string }[] })),
      4,
    ).filter((id) => id !== input.endingPhotoId && id !== input.coverPhotoId);

    const refs = input.refs ?? {};
    const requestId = crypto.randomUUID();
    const payload = buildComposeRequest({
      requestId,
      callbackUrl: `${env.WEB_BASE_URL}/api/v3/internal/job-progress`,
      language: input.language,
      albumTitle: (album.title ?? '').slice(0, 120),
      coverTemplateId: input.coverTemplateId,
      endingTemplateId: input.endingTemplateId,
      chapters,
      interiorPages,
      refs,
    });

    // uq_agent_jobs_album_kind_active 兜底「每本至多一个在跑的成稿 job」:撞上 = 已有在途,
    // 幂等接受(前端继续轮询那一个),不起第二个、也不重复烧 Gemini。
    try {
      await db.transaction(async (tx) => {
        const created = await jobService.createGenerationJob(tx, {
          userId,
          albumId,
          requestId,
          kind: 'compose',
          meta: {
            compose: {
              language: input.language,
              coverTemplateId: input.coverTemplateId,
              coverPhotoId: input.coverPhotoId,
              endingTemplateId: input.endingTemplateId,
              endingPhotoId: input.endingPhotoId,
              extraEndingPhotoIds,
              ...(input.pageBackground ? { pageBackground: input.pageBackground } : {}),
              ...(input.coverColorway ? { coverColorway: input.coverColorway } : {}),
              // 内页随机配色的种子 = albumId:同一本书永远派同一套排列,刷新/重成稿
              // /追加照片都对得上;换一本书才换排列。绝不能用 Math.random。
              interiorSeed: albumId,
            },
          },
        });
        await jobService.markRunning(tx, created.id);
        if (upgradeAmount > 0) {
          await creditService.hold(tx, userId, upgradeAmount, albumId);
        }
      });
    } catch (e) {
      // 只有唯一索引冲突(23505)才是「已有在途成稿」:幂等接受(前端继续轮询那一单),
      // 不建第二个 job、不重复烧 Gemini,也不再追加一条用户气泡。
      // 其余 DB 错误(连接断开、事务序列化失败、迁移没跑导致 agent_job_kind 缺 'compose')
      // 必须原样抛 —— 吞掉它们等于把「迁移没上」伪装成「模型没写出来」,用户还会拿着
      // accepted:true 去轮询一个根本不存在的 job。
      if (!isUniqueViolation(e)) {
        logger.error({ err: String(e), requestId, albumId }, 'create compose job failed');
        throw e;
      }
      return { requestId, accepted: true as const };
    }

    try {
      await agentClient.submitComposeV3(payload);
    } catch (e) {
      logger.error({ err: String(e), requestId, albumId }, 'agent v3 compose submit failed');
      await jobService.handleV3Failed(requestId, {
        code: 'AGENT_INTERNAL_ERROR',
        message: 'Failed to submit compose to agent',
      });
      throw ERRORS.AGENT_INTERNAL_ERROR();
    }

    // submit 成功之后才落「用户选了这组封面」这条消息(回放靠 designApplied 标记原位重建
    // 回执卡)。放在 submit 之前的话,提交失败会在对话里留下一条孤儿封面回执卡 —— 刷新
    // 回放能看到「就用这组封面」,却永远等不来成稿。
    // assistant 的成稿回执由回调侧在真成稿后补 —— 失败时对话里不会留下假的「写好了」。
    await albumMessageRepo.create(db, {
      albumId,
      userId,
      role: 'user',
      content: input.language === 'zh' ? '就用这组封面' : 'Use this cover set',
      layoutPatch: { designApplied: designAppliedMarker(input) },
    });

    return { requestId, accepted: true as const };
  },

  // 游客占位成稿:确认封面后**不派 compose、不碰 Gemini、不动积分**,同步在 Web 端
  // 组书 —— 复用 mergeComposeIntoDraft 传空 compose 载荷 + isPlaceholder=true:内页
  // 文案保留 select-layout 时 engine 已填的模板 sample(fill_sample_texts),封面/
  // 封尾全量落模板 sample(placeholderCoverTextBase,含非标题槽),字体按语言兜底
  // (normalizeDesignFonts),carrier/重烘/pageIndex 重排全部走真成稿同一条纯函数,
  // 画板立刻显示一本完整的「示例文案书」。相册标记 copySource='placeholder',
  // 登录转正后前端检测到它会自动重发 POST /design 跑真 compose(那时才计费)。
  async applyPlaceholderDesign(
    userId: string,
    albumId: string,
    input: {
      language: 'zh' | 'en';
      coverTemplateId: string;
      coverPhotoId: string;
      endingTemplateId: string;
      endingPhotoId: string;
      pageBackground?: string;
      coverColorway?: string;
    },
  ): Promise<{ accepted: true; placeholder: true }> {
    // Creator 授权(collab rework Phase 4):同 applyDesign,游客占位样稿路径。
    const { album } = await collaborationService.requireAccess(userId, albumId);
    if (album.status !== 'EDITING') throw ERRORS.ALBUM_NOT_EDITABLE();
    if (templateCategory(input.coverTemplateId) !== 'cover')
      throw ERRORS.VALIDATION_FAILED(`not a cover template: ${input.coverTemplateId}`);
    if (templateCategory(input.endingTemplateId) !== 'ending')
      throw ERRORS.VALIDATION_FAILED(`not an ending template: ${input.endingTemplateId}`);
    if (input.pageBackground && !isValidPageBackground(input.pageBackground))
      throw ERRORS.VALIDATION_FAILED(`invalid page background: ${input.pageBackground}`);
    if (input.coverColorway && !coverColorwayById(input.coverColorway))
      throw ERRORS.VALIDATION_FAILED(`invalid cover colorway: ${input.coverColorway}`);

    await db.transaction(async (tx) => {
      // 写事务固定次序(与三个回调对齐):album 行锁 → seed → bump → replaceAll → update。
      const locked = await albumRepo.findByIdForUpdate(tx, albumId);
      if (!locked) throw ERRORS.ALBUM_NOT_FOUND();
      const loaded = await loadStoryDraft(locked, { tx, bake: false });
      if (!loaded || loaded.pages.length === 0)
        throw ERRORS.VALIDATION_FAILED('design requires laid-out pages');

      const chapters = Array.isArray((loaded.tree as { chapters?: unknown } | undefined)?.chapters)
        ? ((loaded.tree as { chapters: unknown[] }).chapters as Array<{
            photos?: Array<{ photoId: string }>;
          }>)
        : [];
      const treePhotoIds = new Set(
        chapters.flatMap((c) => (c.photos ?? []).map((p) => p.photoId)),
      );
      if (!treePhotoIds.has(input.coverPhotoId) || !treePhotoIds.has(input.endingPhotoId))
        throw ERRORS.VALIDATION_FAILED('cover/ending photo not in this album');

      const meta: ComposeJobMeta = {
        language: input.language,
        coverTemplateId: input.coverTemplateId,
        coverPhotoId: input.coverPhotoId,
        endingTemplateId: input.endingTemplateId,
        endingPhotoId: input.endingPhotoId,
        extraEndingPhotoIds: pickHeroPhotos(
          chapters.map((c) => ({ photos: (c.photos ?? []) as { photoId: string }[] })),
          4,
        ).filter((id) => id !== input.endingPhotoId && id !== input.coverPhotoId),
        ...(input.pageBackground ? { pageBackground: input.pageBackground } : {}),
        ...(input.coverColorway ? { coverColorway: input.coverColorway } : {}),
        interiorSeed: albumId,
      };
      const draftJsonLike = {
        version: 'v3-story' as const,
        tree: loaded.tree,
        progress: loaded.progress,
        pages: loaded.pages,
        ...(loaded.design ? { design: loaded.design } : {}),
      };
      // 空载荷语义由真成稿同一套纯函数保证:pagesTexts 空 → 内页保留 sample;
      // cover/endingTexts 空 → mergeSlotTexts 落模板 sample;fonts 空 → 按语言兜底。
      const merged = mergeComposeIntoDraft(
        draftJsonLike,
        meta,
        { pagesTexts: {}, coverTexts: {}, endingTexts: {}, fonts: {} },
        // 占位书没有 AI 文案,封面标题槽因此一定走兜底:相册自己的标题优先于模板
        // sample —— 游客看到的示例书至少印着自己那本书的名字,不是 "NORWAY"。
        locked.title,
        // 占位书保留全量 sample 回落(裁决见 task-16):封面/封尾非标题槽也落模板
        // sample。占位书本来就明示是「示例」,不存在「印别人年份地名」的顾虑;
        // 它承担游客的第一印象和转化,封面不该只剩一个大标题。
        true,
      );

      const seededRevision = await ensureDraftPagesSeeded(tx, locked);
      const rev = await bumpDraftRevision(tx, albumId, seededRevision, { structural: true });
      await draftPageRepo.replaceAll(tx, albumId, merged.pages, rev, userId);
      await albumRepo.update(tx, albumId, {
        draftJson: envelopeJson({
          tree: merged.draftJson.tree,
          progress: merged.draftJson.progress,
          design: merged.draftJson.design,
        }),
        pageCount: merged.pages.length,
        copySource: 'placeholder',
        ...(locked.stage !== 'ready' ? { stage: 'ready' as const } : {}),
      });

      // 回放同序:用户气泡(designApplied 供回执卡重建)+ assistant 回执说明是示例文案。
      await albumMessageRepo.create(tx, {
        albumId,
        userId,
        role: 'user',
        content: input.language === 'zh' ? '就用这组封面' : 'Use this cover set',
        // 登录后自动补跑真 compose 时,前端从这条记录恢复完整封面组(含底色/配色)。
        layoutPatch: { designApplied: designAppliedMarker(input) },
      });
      await albumMessageRepo.create(tx, {
        albumId,
        userId,
        role: 'assistant',
        content:
          input.language === 'zh'
            ? '封面就位,整本书排好了!现在书里的文字是示例样稿 —— 登录后我会照你讲的故事写出真文案。'
            : "Cover set — your book is assembled! The words are sample copy for now; sign in and I'll write the real story from what you told me.",
      });
    });

    return { accepted: true as const, placeholder: true as const };
  },

  // 追加范围成稿:加图增量排版落地后,只为这些章的内页写文案(engine /v3/compose,
  // 空 coverSlots/endingSlots → engine 跳过全局批次:不写封面、不回字体)。已设计的书
  // 专用 —— 未设计的书返回 composed:false,新页等用户选封面时随全书成稿一起写。
  // 幂等:与全书成稿共用 (album,'compose') 活跃唯一索引,在途成稿只有一单。
  // 拆表适配(合并 origin/main 时改写):页/树源从 loadStoryDraft 行读 —— main 线原
  // 实现直接读 album.draftJson,对已播种行的相册那是陈旧快照(updatePage 摸过一次
  // 就分叉)。bake:false:这里只提设计三键与图槽归属,不需要现场烘 html。
  async composeAppend(
    userId: string,
    albumId: string,
    input: { language: 'zh' | 'en'; chapterIds: string[]; refs?: Record<string, string> },
    opts: { isAnonymous?: boolean } = {},
  ): Promise<{ accepted: true; composed: boolean; requestId?: string }> {
    // 游客的占位书也「设计过」(carrier 三键齐全),不拦会直接烧 Gemini —— 匿名一律
    // composed:false:新页的 sample 文案在追加排版时已由 engine 填好,真文案等登录后
    // 全书 compose 一起覆盖。
    if (opts.isAnonymous) return { accepted: true, composed: false };
    // Creator 授权(collab rework Phase 4):owner/editor 都可发起追加成稿。
    const { album } = await collaborationService.requireAccess(userId, albumId);
    if (album.status !== 'EDITING' || album.layoutJson != null) throw ERRORS.ALBUM_NOT_EDITABLE();

    const draft = await loadStoryDraft(album, { bake: false });
    const rawPages: Page[] = draft?.pages ?? [];
    if (rawPages.length === 0) throw ERRORS.VALIDATION_FAILED('append compose requires laid-out pages');
    // 设计三键提取不到 = 书没设计过:不派发,新页文案等全书成稿(选封面)一起写。
    if (!extractDesignFromPages(rawPages)) return { accepted: true, composed: false };

    const chapters = (draft?.tree.chapters ?? []) as Array<{
      chapterId?: string;
      title?: string;
      chapterContext?: string;
      place?: string;
      photos?: Array<{ photoId: string; takenAt?: string | null }>;
    }>;
    const scope = new Set(input.chapterIds);
    const scoped = chapters.filter((c) => c.chapterId && scope.has(c.chapterId));
    if (scoped.length !== scope.size) {
      throw ERRORS.VALIDATION_FAILED('unknown chapterId in append compose scope');
    }

    const interiorPages = rawPages.filter((page) => templateCategory(page.templateId) === 'interior');
    const requestId = crypto.randomUUID();
    const payload = buildComposeRequest({
      requestId,
      callbackUrl: `${env.WEB_BASE_URL}/api/v3/internal/job-progress`,
      language: input.language,
      albumTitle: (album.title ?? '').slice(0, 120),
      coverTemplateId: '',
      endingTemplateId: '',
      chapters: scoped,
      interiorPages,
      refs: input.refs ?? {},
    });
    // 范围里的章必须真有页可写(增量排版已合并);全空 = 调用时序错了,诚实拒绝。
    if (payload.chapters.every((c) => c.pages.length === 0)) {
      throw ERRORS.VALIDATION_FAILED('append compose scope has no laid-out pages');
    }

    try {
      await db.transaction(async (tx) => {
        const created = await jobService.createGenerationJob(tx, {
          userId,
          albumId,
          requestId,
          kind: 'compose',
          meta: { composeAppend: { language: input.language, chapterIds: input.chapterIds } },
        });
        await jobService.markRunning(tx, created.id);
      });
    } catch (e) {
      if (!isUniqueViolation(e)) {
        logger.error({ err: String(e), requestId, albumId }, 'create append compose job failed');
        throw e;
      }
      // 唯一索引冲突:已有一条活跃 (album,'compose') job,但不一定是同一批章的重入 ——
      // 也可能是全书成稿,或范围完全不同的另一批追加章,那样无条件 composed:true 会把
      // 本批章无声吞掉(用户以为写了,其实那条在途单根本不认识这些 chapterId)。
      // 只有在途单确实是 composeAppend 且其 chapterIds 覆盖本次请求的全部 chapterIds
      // 时才是真幂等重入;否则诚实拒绝,前端 catch 会给「没能开始写」的气泡。
      const inFlight = await agentJobRepo.findLatestComposeByAlbum(albumId);
      const inFlightActive = inFlight?.status === 'QUEUED' || inFlight?.status === 'RUNNING';
      const inFlightAppendMeta = inFlight ? readComposeAppendMeta(inFlight.meta) : null;
      const sameOrWiderScope =
        !!inFlightAppendMeta && input.chapterIds.every((id) => inFlightAppendMeta.chapterIds.includes(id));
      if (inFlightActive && sameOrWiderScope) {
        return { accepted: true, composed: true };
      }
      throw ERRORS.VALIDATION_FAILED('append compose scope conflicts with an in-flight compose job');
    }

    try {
      await agentClient.submitComposeV3(payload);
    } catch (e) {
      logger.error({ err: String(e), requestId, albumId }, 'agent v3 append compose submit failed');
      await jobService.handleV3Failed(requestId, {
        code: 'AGENT_INTERNAL_ERROR',
        message: 'Failed to submit append compose to agent',
      });
      throw ERRORS.AGENT_INTERNAL_ERROR();
    }

    return { accepted: true, composed: true, requestId };
  },

  // Hard delete. FK ON DELETE CASCADE drops pages / messages / jobs / holds /
  // photos in the same statement; credit_ledger.related_album_id is set null so
  // the audit trail survives. A still-HOLDING hold never debited the balance, so
  // removing it strands no credit. album_photos is still deleted explicitly
  // (belt-and-suspenders alongside the FK cascade, same as the rest of this
  // method relying on cascade for album_pages etc).
  //
  // Row-locked (findByIdForUpdate) rather than a plain findOwned: photo-original
  // confirm() takes the same albums row lock before reading/writing album_photos,
  // so locking here too serializes delete against a concurrent confirm instead of
  // racing an unlocked deleteByAlbum against confirm's read-then-upsert.
  async delete(userId: string, albumId: string): Promise<void> {
    await db.transaction(async (tx) => {
      const album = await albumRepo.findByIdForUpdate(tx, albumId);
      if (!album) throw ERRORS.ALBUM_NOT_FOUND();
      if (album.userId !== userId) throw ERRORS.ALBUM_NOT_OWNED();
      await albumPhotoRepo.deleteByAlbum(tx, albumId);
      await albumRepo.delete(tx, albumId);
    });
  },

  // Editor saves a single page (docs/web/api.md §3.5). The whole layout_json is
  // owned by generation/chat; direct edits only touch the per-page row.
  //
  // 【C 方案分叉】authoring 草稿的唯一真相是 albums.draft_json(页含 html),
  // AI(design-agent 读 draft)和导出(渲 draft html)都只认它。此前这里无条件写
  // album_pages 表 —— 草稿相册的手工编辑(改字/挪图/样式)全部进了一张没人读的
  // 表,刷新即回退。现在:有 draft → patch draft_json(texts 同步 + html 槽位级
  // patch,锚点失配整页重烘);没 draft(老/finalized 相册)→ 维持 album_pages。
  async updatePage(
    userId: string,
    albumId: string,
    pageIndex: number,
    patch: {
      imagesJson?: Record<string, string>;
      textsJson?: Record<string, string>;
      // #165: per-slot position/scale overrides. The editor already applies the
      // photo-swap reset (clearing a slot's entry when its photoId changed) via
      // applyPatchToPages before persisting, so the server stores what it sends.
      imagePosJson?: Record<string, ImagePos>;
      // 工具条样式(字号/字体/加粗/对齐/颜色):slotKey → CSS 属性(null=移除)。
      // 只对 html 真相有意义,album_pages 旧路径忽略它。
      textStyles?: Record<string, Record<string, string | null>>;
      // 页级样式(书页背景色):CSS 属性 → 值(null=移除,回落模板默认)。写页根
      // (data-template 外框)的行内 style。同 textStyles,只对 html 真相有意义。
      pageStyle?: Record<string, string | null>;
    },
    // 页面 OCC(collab plan §7.5/§8):客户端所见的页面 version。提供时行版本
    // 必须精确匹配,否则 409 EDIT_CONFLICT(零写入)。发布阶段 A(§16):owner
    // 旧客户端不带它时暂走旧盲写;editor 不带必须拒绝;阶段 C 全量收紧。
    baseVersion?: number,
  ): Promise<
    | { updated: true }
    | { updated: true; pageIndex: number; version: number; revision: number; page: V3Page & { html?: string } }
  > {
    let savedVersion: number | null = null;
    let savedPage: (V3Page & { html?: string }) | null = null;
    await db.transaction(async (tx) => {
      // 固定事务顺序(collab plan §8):①行锁 ②访问 ③V3 校验 ④播种 ⑤读目标页
      // ⑥版本比对 ⑦失配即 409(零写入) ⑧应用 patch ⑨bump revision ⑩条件更新
      // ⑪既有副作用 ⑫返回。
      const latest = await albumRepo.findByIdForUpdate(tx, albumId);
      if (!latest) throw ERRORS.ALBUM_NOT_FOUND();
      // ② 协同访问:owner 或 editor 都可单页写;非成员拒绝。行锁内判角色,
      // 避免 requireAccess 无锁读的 TOCTOU 窗口。
      const role = await resolveRole(latest, userId, tx);
      if (!role) throw COLLAB_ERRORS.ALBUM_ACCESS_DENIED();
      // 阶段 A:editor 的保存必须基于精确 version(owner 旧客户端豁免到阶段 C)。
      if (baseVersion === undefined && role === 'editor') {
        throw ERRORS.VALIDATION_FAILED('baseVersion is required for collaborative saves');
      }

      // draft_pages 拆表(Phase 1a)固定写事务次序:行锁(above)→ 懒播种 → 行级写
      // → bump revision(docs/plans/2026-08-03-draft-pages-split.md Global
      // Constraints)。播种对没有 legacy pages 的相册是 no-op,返回值就是不变的
      // 当前 revision——`bumpDraftRevision` 必须接它而不是 `latest.draftRevision`,
      // 否则刚播种(0→1)的相册这次写入会把 revision 撞错。
      const seededRevision = await ensureDraftPagesSeeded(tx, latest);
      // bake:true(not false) is load-bearing here: a page that has never had
      // `html` baked must come back WITH a freshly-baked html so the
      // textStyles/pageStyle patch calls below have something to attach to.
      // This restores the old `readStoryDraft`'s wrapped-branch behavior
      // (bakePagesHtml on read, before the patch block ran) — bake:false would
      // leave `page.html` undefined, skip every guarded html patch, and the
      // tail's bakePageHtml({strict:false}) fallback has no textStyles/
      // pageStyle inputs to rebake from (those only ever exist as inline style
      // mutations on an html string, never as a Page data field), so a
      // textStyles/pageStyle edit on such a page would silently vanish while
      // still returning {updated:true}.
      const draft = await loadStoryDraft(latest, { tx, bake: true });
      if (!draft || !draft.pages.length) {
        // ③ 协同(带 baseVersion)只允许命中 draft_pages 路径:legacy album_pages
        // 分支没有页面 version,不得执行无 version 写入(collab plan §7.5)。
        if (baseVersion !== undefined) throw COLLAB_ERRORS.COLLAB_UNSUPPORTED_ALBUM();
        await albumPageRepo.updateOne(tx, albumId, pageIndex, {
          imagesJson: patch.imagesJson,
          textsJson: patch.textsJson,
          imagePosJson: patch.imagePosJson,
        });
        // Touch the album in the same lock order as confirmation so every
        // non-draft page edit advances the revision snapshot. Page 0 also
        // invalidates the stored browser-derived cover immediately.
        await albumRepo.update(tx, albumId, {
          ...(latest.status === 'COMPLETED' ? { status: 'EDITING' as const } : {}),
          ...(pageIndex === 0
            ? { coverThumbnailUrl: null, coverThumbnailR2Key: null }
            : {}),
        });
        return;
      }
      // pageIndex 参数是页对象的 **pageIndex 字段**,不是数组下标(与 deletePage 同一
      // 条线上契约,2026-08-03 线上 400 复盘):存量相册字段可能不连续(线上见 129/132),
      // 按下标取页轻则报错、重则字段值恰好落在数组范围内 → 静默改错页。按字段解析,
      // 字段重复(旧管线按章节计数的遗留)宁拒不猜。draft_pages 行键即字段,updateOne
      // 直接用参数定位行,与这里的解析口径一致。
      const existingMatches = draft.pages.filter((p) => p.pageIndex === pageIndex);
      if (existingMatches.length === 0) {
        throw ERRORS.VALIDATION_FAILED(`draft page ${pageIndex} not found`);
      }
      if (existingMatches.length > 1) {
        throw ERRORS.VALIDATION_FAILED(`draft page ${pageIndex} is ambiguous (duplicate pageIndex)`);
      }
      const existing = existingMatches[0]!;
      const existingIdx = draft.pages.indexOf(existing);

      // ⑥ 版本比对(collab plan §8):baseVersion 必须与行的当前 version 精确
      // 相等。失配 → 409 + 结构化 details(当前页全文只经响应返回),事务回滚,
      // 零写入、零 revision 推进。
      if (baseVersion !== undefined) {
        // 只为拿一行的 version,不能 findByAlbum 把整本书的页 JSON(每页一份
        // 794×1123 的 html)都捞回来 —— listVersions 只 select pageIndex+version。
        const row = (await draftPageRepo.listVersions(albumId, tx)).find(
          (r) => r.pageIndex === pageIndex,
        );
        if (!row || row.version !== baseVersion) {
          // 失配才需要把当前页全文取回来塞进 details(客户端「查看最新版本」)。
          const current = row
            ? (await draftPageRepo.findByAlbum(albumId, tx)).find((r) => r.pageIndex === pageIndex) ?? null
            : null;
          // 日志只允许 id/版本号(collab plan §19):页面正文、html、图片引用
          // 和完整 currentPage 一律不落日志。
          logger.info(
            {
              albumId,
              pageIndex,
              userId,
              baseVersion,
              currentVersion: current?.version ?? null,
            },
            'collab.page_conflict',
          );
          throw COLLAB_ERRORS.EDIT_CONFLICT({
            pageIndex,
            currentVersion: current?.version ?? -1,
            currentPage: current?.page ?? null,
          });
        }
      }

      const page = { ...existing } as V3Page & { html?: string };
      // html 逐笔 patch;任何一笔失配 → 置 null,收尾整页重烘(宁可丢手工版面
      // 微调,不能让页面显示旧内容)。
      let html: string | null =
        typeof page.html === 'string' && page.html.length > 0 ? page.html : null;

      if (patch.textsJson) {
        const before = page.texts ?? {};
        for (const [key, value] of Object.entries(patch.textsJson)) {
          if (html !== null && before[key] !== value && !key.includes('#')) {
            html = patchHtmlText(html, key, value);
          }
        }
        page.texts = patch.textsJson;
      }
      if (patch.imagesJson) {
        // 存库 html 的图片位保留 {{IMG_SRC:slot}} token,显示时按 images 解析 ——
        // 换图/删图只动数据层,html 无需 patch。
        page.images = patch.imagesJson;
      }
      if (patch.imagePosJson) {
        const before = page.imagePos ?? {};
        for (const [slot, pos] of Object.entries(patch.imagePosJson)) {
          const prev = before[slot];
          if (html !== null && (!prev || prev.x !== pos.x || prev.y !== pos.y || prev.scale !== pos.scale || prev.rotate !== pos.rotate)) {
            // patch 失败保留原 html(?? html):图片位置是装饰性行内样式,失败只是
            // 这一笔不生效;置 null 走整页重烘会把用户手工背景/字色和 AI 配色一起
            // 从库里抹掉(2026-08-02 用户上报「导出丢手工样式」的根因)。
            html = patchHtmlImagePos(html, slot, pos) ?? html;
          }
        }
        page.imagePos = patch.imagePosJson;
      }
      if (patch.textStyles) {
        for (const [slot, props] of Object.entries(patch.textStyles)) {
          if (html !== null) html = patchHtmlTextStyle(html, slot, props);
        }
      }
      if (patch.pageStyle && html !== null) {
        html = patchHtmlPageStyle(html, patch.pageStyle);
      }

      if (html !== null) {
        page.html = html;
      } else {
        const rebaked = bakePageHtml({ ...page, html: undefined }, { strict: false });
        page.html = rebaked.html;
      }

      const rev = await bumpDraftRevision(tx, albumId, seededRevision);
      if (baseVersion !== undefined) {
        // ⑩ 条件更新是最后防线(§8.1):即便未来有调用点绕过行锁预比较,
        // version 不匹配也写不进去。失配时重读行取最新 details 再 409。
        const won = await draftPageRepo.updateOneIfVersion(
          tx, albumId, pageIndex, baseVersion, page, rev, userId,
        );
        if (!won) {
          const current = (await draftPageRepo.findByAlbum(albumId, tx)).find(
            (r) => r.pageIndex === pageIndex,
          ) ?? null;
          logger.info(
            {
              albumId,
              pageIndex,
              userId,
              baseVersion,
              currentVersion: current?.version ?? null,
            },
            'collab.page_conflict',
          );
          throw COLLAB_ERRORS.EDIT_CONFLICT({
            pageIndex,
            currentVersion: current?.version ?? -1,
            currentPage: current?.page ?? null,
          });
        }
      } else {
        await draftPageRepo.updateOne(tx, albumId, pageIndex, page, rev, userId);
      }
      // envelope(tree/progress/design)不重写:页真相已迁 draft_pages,这次编辑
      // 没有动 tree/progress,draftJson 保持原样。副作用不变:编辑已 COMPLETED 的
      // 书 → 退回 EDITING(photo-snapshot §5.5,同上);第一页(数组位 0 = 封面)被改
      // 清封面缩略图缓存 —— 按解析后的数组位判断,稀疏相册封面字段未必是 0。
      await albumRepo.update(tx, albumId, {
        ...(latest.status === 'COMPLETED' ? { status: 'EDITING' as const } : {}),
        ...(existingIdx === 0
          ? { coverThumbnailUrl: null, coverThumbnailR2Key: null }
          : {}),
      });
      savedVersion = rev;
      savedPage = page;
    });
    if (savedVersion === null || savedPage === null) {
      // legacy album_pages 分支(阶段 A 的 owner 盲写)保持原返回形状。
      return { updated: true };
    }
    // 成功日志只含 id/版本号(collab plan §19)。
    logger.info(
      { albumId, pageIndex, userId, version: savedVersion, revision: savedVersion },
      'collab.page_saved',
    );
    return { updated: true, pageIndex, version: savedVersion, revision: savedVersion, page: savedPage };
  },

  // ── 页序重排的原子落库(2026-08-01 设计引入,2026-08-02 页序弹窗沿用:
  // docs/specs/2026-08-02-page-reorder-modal-design.md)。逐页 PATCH 表达不了它:
  // body 不收 templateId/html,且插入/块移会让中间每一页 pageIndex 平移,逐页写
  // 既不原子又会在中间态撞 html 逐笔 patch 的语义。所以是一份完整置换、一个事务。
  //
  // permutation[newIndex] = oldIndex。整条页记录(templateId/images/texts/
  // imagePos/html)原样跟着走 —— 变的是页的**位置**,页内一切不变,html 一个
  // 字不碰(与图片交换只动 imagesJson 刻意不同,见 page-reorder.ts 抬头)。
  async reorderPages(
    userId: string,
    albumId: string,
    permutation: number[],
    // 结构 OCC(Phase 2A):客户端所见的结构版本基线。事务内与 locked
    // draftStructureRevision 精确比较,失配即 409 STRUCTURE_CONFLICT 零写入;
    // 匹配才执行并把结构版本推进到新 revision。
    // 阶段 A 过渡态(同 baseVersion):owner 可省略走旧盲写,editor 必须带。
    baseStructureRevision?: number,
  ): Promise<{ updated: true; structureRevision: number }> {
    let structureRevision = 0;
    await db.transaction(async (tx) => {
      const latest = await albumRepo.findByIdForUpdate(tx, albumId);
      if (!latest) throw ERRORS.ALBUM_NOT_FOUND();
      // ② 结构 OCC 访问:owner/editor 都可重排(产品口径),非成员拒绝。行锁内
      // 判角色,与 updatePage 同一 TOCTOU 防线。
      const role = await resolveRole(latest, userId, tx);
      if (!role) throw COLLAB_ERRORS.ALBUM_ACCESS_DENIED();
      // ③ 阶段 A 过渡态:owner 旧客户端不带基线走旧盲写,editor 不带一律拒绝。
      if (baseStructureRevision === undefined && role === 'editor') {
        throw ERRORS.VALIDATION_FAILED('baseStructureRevision is required for collaborative saves');
      }
      // ④ 结构版本比对:早于 ensureDraftPagesSeeded(会写行)即返回,省掉无谓的播种写
      // (零写入本身由事务回滚保证,不依赖这个顺序)。
      if (baseStructureRevision !== undefined && latest.draftStructureRevision !== baseStructureRevision) {
        throw COLLAB_ERRORS.STRUCTURE_CONFLICT({
          currentStructureRevision: latest.draftStructureRevision,
        });
      }

      // draft_pages 拆表(Phase 1a)固定写事务次序,同 updatePage(Task 3):行锁
      // (above)→ 懒播种 → 用 loadStoryDraft 的行/回退判定路由。这里不能再用旧的
      // 「直接读 draftJson.pages」判定:Task 3 之后 updatePage 只写行、不回写
      // draftJson.pages,被 updatePage 摸过的相册 draftJson.pages 从此是陈旧快
      // 照 —— 旧判定会在重排时用陈旧文案覆盖刚写的新文案(两轮 review 标记的误
      // 路由隐患,回归守卫见 album-service.test.ts 的「reorderPages 路由判定必须
      // 与 updatePage 一致」用例)。bake:false:这里不碰 html 一个字节,不需要现
      // 场烘(html 逐字节不动的既有语义保留)。
      const seededRevision = await ensureDraftPagesSeeded(tx, latest);
      const draft = await loadStoryDraft(latest, { tx, bake: false });
      const hasDraft = !!draft && draft.pages.length > 0;
      const legacyRows = hasDraft ? null : await albumPageRepo.findByAlbum(tx, albumId);
      const n = hasDraft ? draft!.pages.length : legacyRows!.length;

      // 完整双射校验:长度一致、每个 0..n-1 恰好出现一次。
      if (permutation.length !== n) {
        throw ERRORS.VALIDATION_FAILED(`permutation length ${permutation.length} != page count ${n}`);
      }
      const seen = new Set(permutation);
      if (seen.size !== n || permutation.some((i) => !Number.isInteger(i) || i < 0 || i >= n)) {
        throw ERRORS.VALIDATION_FAILED('permutation must be a bijection of 0..n-1');
      }
      // 锚定页(cover/toc/ending)不许动 —— 服务端二次把关,不只靠前端置灰。
      const templateIdAt = (i: number): string =>
        hasDraft ? draft!.pages[i]!.templateId : legacyRows![i]!.templateId;
      for (let newIdx = 0; newIdx < n; newIdx++) {
        const oldIdx = permutation[newIdx]!;
        if (oldIdx === newIdx) continue;
        const category = getTemplate(templateIdAt(oldIdx))?.category;
        if (category === 'cover' || category === 'toc' || category === 'ending') {
          throw ERRORS.VALIDATION_FAILED(`page ${oldIdx} (${category}) is anchored and cannot move`);
        }
      }
      const touchesCover = permutation[0] !== 0;

      if (hasDraft) {
        // 置换后整条记录跟着走,html 一个字不碰(与图片交换只动 imagesJson 刻意
        // 不同,见本函数抬头注释)。
        const permuted = permutation.map((oldIdx, newIdx) => ({
          ...draft!.pages[oldIdx]!,
          pageIndex: newIdx,
        }));
        const rev = await bumpDraftRevision(tx, albumId, seededRevision, { structural: true });
        structureRevision = rev;
        await draftPageRepo.replaceAll(tx, albumId, permuted, rev, userId);
        // envelope(tree/progress/design)不重写:页真相已迁 draft_pages,重排没
        // 有动 tree/progress。pageCount 收口点一:整书替换后行数就是新的真相
        // 页数(此前这里遗漏了 pageCount,拆表前 pages 与 pageCount 天然同源,
        // 拆表后二者分离,必须显式跟上)。
        await albumRepo.update(tx, albumId, {
          pageCount: permuted.length,
          ...(latest.status === 'COMPLETED' ? { status: 'EDITING' as const } : {}),
          // 防御:类目校验已经挡住封面移动,万一 0 号位真被换了,过期封面缩略图不能留。
          ...(touchesCover ? { coverThumbnailUrl: null, coverThumbnailR2Key: null } : {}),
        });
        return;
      }

      // 存量路径(album_pages 行):表上有 unique(albumId, pageIndex),原地互写会撞
      // 索引 —— 与 add-photos 同法 delete-then-bulkInsert(见 deleteByAlbum 注释)。
      await albumPageRepo.deleteByAlbum(tx, albumId);
      await albumPageRepo.bulkInsert(
        tx,
        permutation.map((oldIdx, newIdx) => {
          const { id: _id, updatedAt: _u, ...row } = legacyRows![oldIdx]!;
          return { ...row, pageIndex: newIdx };
        }),
      );
      await albumRepo.update(tx, albumId, {
        ...(latest.status === 'COMPLETED' ? { status: 'EDITING' as const } : {}),
        ...(touchesCover ? { coverThumbnailUrl: null, coverThumbnailR2Key: null } : {}),
      });
      // legacy(album_pages)分支没有 draft_pages 行,也就没有结构版本可推进 ——
      // 基线比对在这条路径上是空转,structureRevision 原样返回。
      //
      // 只对 editor 显式拒绝,不拒 owner:存量 legacy 相册的重排/删页是 owner
      // 一直在用的功能,不能因为协同上线就断掉。editor 事实上也到不了这里
      // (invitationReadiness 要求 layoutJson === null 且 draft_pages 已播种,
      // legacy 相册根本发不出邀请),这条守的是口径明确 —— 协同写路径要么有真
      // OCC,要么明确拒绝,不给假的安全感。
      if (role === 'editor') throw COLLAB_ERRORS.COLLAB_UNSUPPORTED_ALBUM();
      structureRevision = latest.draftStructureRevision;
    });
    return { updated: true, structureRevision };
  },

  // ── 删除书页(2026-08-03 设计:docs/specs/2026-08-03-delete-page-design.md)。
  // 只删内页(cover/toc/ending 拒绝 —— 服务端二次把关,不只靠前端置灰);图片随页
  // 移除不回流;拒绝删到内页数为 0。余页 pageIndex 重排 0..n-1(PK (albumId,
  // pageIndex) 要求连续无洞),pageCount 收口,COMPLETED → EDITING。
  // 事务骨架与路由判定照抄 reorderPages(理由见其抬头):行锁 → 懒播种 →
  // loadStoryDraft 判定行/存量路径。bake:false —— 删页不碰余页 html 一个字节。
  //
  // pageIndex 参数是页对象的 **pageIndex 字段**,不是数组下标(2026-08-03 线上 400
  // 复盘):/pages/[idx] 的既有线上契约来自 updatePage 前端 —— 桌面 data-page-index
  // 写 String(page.pageIndex)、pageByIndex 按字段 find、移动端 persistPage 发
  // page.pageIndex。存量相册字段可能不连续(线上见 129/132),按下标解析会越界/错位。
  // 删后重编号 0..n-1 顺带把这类相册洗回连续(自愈)。
  async deletePage(
    userId: string,
    albumId: string,
    pageIndex: number,
    // 结构 OCC(Phase 2A):与 reorderPages 同一基线契约 —— 失配 409 零写入。
    // 阶段 A 过渡态(同 baseVersion):owner 可省略走旧盲写,editor 必须带。
    baseStructureRevision?: number,
  ): Promise<{ updated: true; structureRevision: number }> {
    let structureRevision = 0;
    await db.transaction(async (tx) => {
      const latest = await albumRepo.findByIdForUpdate(tx, albumId);
      if (!latest) throw ERRORS.ALBUM_NOT_FOUND();
      // 结构 OCC 访问:owner/editor 都可删页;非成员拒绝。行锁内判角色。
      const role = await resolveRole(latest, userId, tx);
      if (!role) throw COLLAB_ERRORS.ALBUM_ACCESS_DENIED();
      // 阶段 A 过渡态:owner 旧客户端不带基线走旧盲写,editor 不带一律拒绝。
      if (baseStructureRevision === undefined && role === 'editor') {
        throw ERRORS.VALIDATION_FAILED('baseStructureRevision is required for collaborative saves');
      }
      // 结构版本比对:早于 ensureDraftPagesSeeded(会写行)即返回,省掉无谓的播种写
      // (零写入本身由事务回滚保证,不依赖这个顺序)。
      if (baseStructureRevision !== undefined && latest.draftStructureRevision !== baseStructureRevision) {
        throw COLLAB_ERRORS.STRUCTURE_CONFLICT({
          currentStructureRevision: latest.draftStructureRevision,
        });
      }

      const seededRevision = await ensureDraftPagesSeeded(tx, latest);
      const draft = await loadStoryDraft(latest, { tx, bake: false });
      const hasDraft = !!draft && draft.pages.length > 0;
      const legacyRows = hasDraft ? null : await albumPageRepo.findByAlbum(tx, albumId);
      const n = hasDraft ? draft!.pages.length : legacyRows!.length;

      const fieldAt = (i: number): number =>
        hasDraft ? draft!.pages[i]!.pageIndex : legacyRows![i]!.pageIndex;
      const matches: number[] = [];
      for (let i = 0; i < n; i++) if (fieldAt(i) === pageIndex) matches.push(i);
      if (matches.length === 0) {
        throw ERRORS.VALIDATION_FAILED(`page ${pageIndex} not found`);
      }
      if (matches.length > 1) {
        // 字段重复 = 页身份歧义(旧管线按章节计数的遗留),宁拒不猜 —— 删错页不可恢复。
        throw ERRORS.VALIDATION_FAILED(`page ${pageIndex} is ambiguous (duplicate pageIndex)`);
      }
      const arrayIdx = matches[0]!;
      const templateIdAt = (i: number): string =>
        hasDraft ? draft!.pages[i]!.templateId : legacyRows![i]!.templateId;
      const category = getTemplate(templateIdAt(arrayIdx))?.category;
      if (category !== 'interior') {
        throw ERRORS.VALIDATION_FAILED(
          `page ${pageIndex} (${category ?? 'unknown'}) is anchored and cannot be deleted`,
        );
      }
      // 下限保护:删后至少留一张内页(规格:拒绝删到内页数为 0)。
      let interiorCount = 0;
      for (let i = 0; i < n; i++) {
        if (getTemplate(templateIdAt(i))?.category === 'interior') interiorCount += 1;
      }
      if (interiorCount <= 1) {
        throw ERRORS.VALIDATION_FAILED('cannot delete the last interior page');
      }

      if (hasDraft) {
        const remaining = draft!.pages
          .filter((_, i) => i !== arrayIdx)
          .map((page, newIdx) => ({ ...page, pageIndex: newIdx }));
        const rev = await bumpDraftRevision(tx, albumId, seededRevision, { structural: true });
        structureRevision = rev;
        await draftPageRepo.replaceAll(tx, albumId, remaining, rev, userId);
        // envelope(tree/progress/design)不重写:删页没有动 tree/progress。
        // pageCount 收口:页数变化写点必须显式跟上(同 reorderPages 收口点一)。
        await albumRepo.update(tx, albumId, {
          pageCount: remaining.length,
          ...(latest.status === 'COMPLETED' ? { status: 'EDITING' as const } : {}),
        });
        return;
      }

      // 存量路径(album_pages 行):unique(albumId,pageIndex) 原地平移会撞索引,
      // 与 reorderPages 同法 delete-then-bulkInsert。
      await albumPageRepo.deleteByAlbum(tx, albumId);
      await albumPageRepo.bulkInsert(
        tx,
        legacyRows!
          .filter((_, i) => i !== arrayIdx)
          .map((row, newIdx) => {
            const { id: _id, updatedAt: _u, ...rest } = row;
            return { ...rest, pageIndex: newIdx };
          }),
      );
      await albumRepo.update(tx, albumId, {
        pageCount: legacyRows!.length - 1,
        ...(latest.status === 'COMPLETED' ? { status: 'EDITING' as const } : {}),
      });
      // legacy(album_pages)分支没有 draft_pages 行,也就没有结构版本可推进 ——
      // 基线比对在这条路径上是空转,structureRevision 原样返回。
      //
      // 只对 editor 显式拒绝,不拒 owner:存量 legacy 相册的重排/删页是 owner
      // 一直在用的功能,不能因为协同上线就断掉。editor 事实上也到不了这里
      // (invitationReadiness 要求 layoutJson === null 且 draft_pages 已播种,
      // legacy 相册根本发不出邀请),这条守的是口径明确 —— 协同写路径要么有真
      // OCC,要么明确拒绝,不给假的安全感。
      if (role === 'editor') throw COLLAB_ERRORS.COLLAB_UNSUPPORTED_ALBUM();
      structureRevision = latest.draftStructureRevision;
    });
    return { updated: true, structureRevision };
  },

  // Editor renames the album from the topbar (docs/web/api.md §1 — PATCH base
  // fields). Only the title is mutable here; layout/status are owned by
  // generation/chat/pdf flows. 全局创作设置 OCC(Phase 2B):owner/editor 同为
  // Creator,行锁内 resolveRole + 精确比较 settingsRevision,失配 409 零写。
  // 锁外不预查归属(避免 TOCTOU):纯输入校验在外,访问判定一律在锁内。
  async updateTitle(
    userId: string,
    albumId: string,
    title: string,
    // 阶段 A 过渡态:owner 可省略(走旧盲写),editor 必须带 —— 见 lockAlbumForSettingsWrite。
    baseSettingsRevision?: number,
  ): Promise<{ title: string; settingsRevision: number }> {
    const trimmed = title.trim();
    if (!trimmed) throw ERRORS.VALIDATION_FAILED('title must not be empty');
    return db.transaction(async (tx) => {
      const latest = await lockAlbumForSettingsWrite(tx, userId, albumId, baseSettingsRevision);
      const settingsRevision = latest.settingsRevision + 1;
      await albumRepo.update(tx, albumId, { title: trimmed, settingsRevision });
      return { title: trimmed, settingsRevision };
    });
  },

  // 预览垫底背景(相册级视觉属性)。null = 清除。写库前收敛校验,非法当无背景。
  // 全局创作设置 OCC(Phase 2B):与 updateTitle 同款行锁 + 基线比较 + 推进一次。
  async updateBoardBackground(
    userId: string,
    albumId: string,
    board: unknown,
    // 阶段 A 过渡态:owner 可省略(走旧盲写),editor 必须带 —— 见 lockAlbumForSettingsWrite。
    baseSettingsRevision?: number,
  ): Promise<{ boardBackground: BoardBackground | null; settingsRevision: number }> {
    const normalized = board == null ? null : normalizeBoardBackground(board);
    return db.transaction(async (tx) => {
      const latest = await lockAlbumForSettingsWrite(tx, userId, albumId, baseSettingsRevision);
      const settingsRevision = latest.settingsRevision + 1;
      await albumRepo.update(tx, albumId, { boardBackground: normalized, settingsRevision });
      return { boardBackground: normalized, settingsRevision };
    });
  },

  async updatePhotoFilter(
    userId: string,
    albumId: string,
    state: PhotoFilterState | null,
    // 阶段 A 过渡态:owner 可省略(走旧盲写),editor 必须带 —— 见 lockAlbumForSettingsWrite。
    baseSettingsRevision?: number,
  ): Promise<{ photoFilter: PhotoFilterState | null; settingsRevision: number }> {
    const normalized =
      state === null
        ? null
        : normalizePhotoFilterState(PhotoFilterStateSchema.parse(state));

    return db.transaction(async (tx) => {
      const latest = await lockAlbumForSettingsWrite(tx, userId, albumId, baseSettingsRevision);
      const settingsRevision = latest.settingsRevision + 1;
      await albumRepo.update(tx, albumId, {
        photoFilter: normalized,
        settingsRevision,
        pdfUrl: null,
        pdfR2Key: null,
        coverThumbnailUrl: null,
        coverThumbnailR2Key: null,
        ...(latest.status === 'COMPLETED' ? { status: 'EDITING' as const } : {}),
      });
      return { photoFilter: normalized, settingsRevision };
    });
  },

  // Returns { putUrl, r2Key, publicUrl } so the browser can PUT a PDF directly
  // to R2. Web never touches the bytes — invariant 4.
  async signPdfUpload(
    userId: string,
    albumId: string,
    input: { contentType: string; size: number },
  ): Promise<{ putUrl: string; r2Key: string; publicUrl: string }> {
    if (input.contentType !== 'application/pdf') {
      throw ERRORS.VALIDATION_FAILED('contentType must be application/pdf');
    }
    if (input.size <= 0 || input.size > PDF_MAX_BYTES) throw ERRORS.PDF_TOO_LARGE();

    const { album } = await collaborationService.requireAccess(userId, albumId);
    assertStoryExportUnlocked(album);

    // 导出(collab rework §3.2):key 归 **album** 命名空间且每次带独立 exportId ——
    // 协作者的导出不互相覆盖文件(后 confirm 的只是把相册 pdfUrl 指针挪到最新一份,
    // 旧文件留在 R2,已发出的旧链接不失效)。
    const r2Key = `pdfs/${album.id}/${crypto.randomUUID()}.pdf`;
    const putUrl = await r2.signPutUrl(r2Key, input.contentType, 300);
    return { putUrl, r2Key, publicUrl: r2.publicUrl(r2Key) };
  },

  // Browser has finished the direct R2 PUT; record metadata + mark COMPLETED
  // (docs/web/api.md §3.7). Credit was already settled at generation completion,
  // so no settle here. The r2Key is bound to the {userId}/{albumId} namespace
  // signPdfUpload issued, so a forged key for another album is rejected.
  async confirmPdf(
    userId: string,
    albumId: string,
    r2Key: string,
  ): Promise<{ pdfUrl: string }> {
    // 先提取 albumId 段再比较,不把 albumId 内插进正则(路径参数可能含正则元字符)。
    const keyMatch = /^pdfs\/([^/]+)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/.exec(r2Key);
    if (!keyMatch || keyMatch[1] !== albumId) {
      throw ERRORS.VALIDATION_FAILED('r2Key does not match album');
    }

    const pdfUrl = r2.publicUrl(r2Key);
    await db.transaction(async (tx) => {
      const album = await albumRepo.findByIdForUpdate(tx, albumId);
      if (!album) throw ERRORS.ALBUM_NOT_FOUND();
      const role = await resolveRole(album, userId, tx);
      if (!role) throw COLLAB_ERRORS.ALBUM_ACCESS_DENIED();
      assertStoryExportUnlocked(album);
      await albumRepo.update(tx, albumId, { pdfR2Key: r2Key, pdfUrl, status: 'COMPLETED' });
    });
    return { pdfUrl };
  },

  async signCoverThumbnailUpload(
    userId: string,
    albumId: string,
    input: { contentType: string; size: number },
  ): Promise<{ putUrl: string; r2Key: string; publicUrl: string; coverRevision: string }> {
    if (input.contentType !== COVER_THUMB_CONTENT_TYPE) {
      throw ERRORS.VALIDATION_FAILED('contentType must be image/jpeg');
    }
    if (input.size <= 0 || input.size > COVER_THUMB_MAX_BYTES) {
      throw ERRORS.VALIDATION_FAILED('cover thumbnail must be <= 512KB');
    }

    const { coverRevision, r2Key } = await db.transaction(async (tx) => {
      const album = await albumRepo.findByIdForUpdate(tx, albumId);
      if (!album) throw ERRORS.ALBUM_NOT_FOUND();
      if (album.userId !== userId) throw ERRORS.ALBUM_NOT_OWNED();
      const coverRevision = await coverThumbnailRevision(tx, album);
      return {
        coverRevision,
        r2Key: `cover-thumbs/${userId}/${albumId}/${coverRevision}.jpg`,
      };
    });
    const putUrl = await r2.signPutUrl(r2Key, input.contentType, 300);
    return { putUrl, r2Key, publicUrl: r2.publicUrl(r2Key), coverRevision };
  },

  async confirmCoverThumbnail(
    userId: string,
    albumId: string,
    input: { r2Key: string; coverRevision: string },
  ): Promise<{ coverThumbnailUrl: string }> {
    if (!/^[a-f0-9]{64}$/.test(input.coverRevision)) {
      throw ERRORS.VALIDATION_FAILED('coverRevision is invalid');
    }
    let coverThumbnailUrl = '';
    await db.transaction(async (tx) => {
      const album = await albumRepo.findByIdForUpdate(tx, albumId);
      if (!album) throw ERRORS.ALBUM_NOT_FOUND();
      if (album.userId !== userId) throw ERRORS.ALBUM_NOT_OWNED();

      const currentRevision = await coverThumbnailRevision(tx, album);
      if (input.coverRevision !== currentRevision) {
        throw ERRORS.VALIDATION_FAILED('cover thumbnail revision is stale');
      }
      const expected = `cover-thumbs/${userId}/${albumId}/${currentRevision}.jpg`;
      if (input.r2Key !== expected) throw ERRORS.VALIDATION_FAILED('r2Key does not match album');

      // The immutable revision is already the cache buster; legacy stored URLs
      // remain readable while new confirmations never depend on Date.now().
      coverThumbnailUrl = r2.publicUrl(input.r2Key);
      await albumRepo.update(tx, albumId, {
        coverThumbnailR2Key: input.r2Key,
        coverThumbnailUrl,
      });
    });
    return { coverThumbnailUrl };
  },

  // Manual photo backup (photo-snapshot-design.md). Returns one signed PUT per
  // exact photoId/renderVersion so the browser uploads the current display-tier
  // derived JPEG straight to immutable R2 keys. 原图仍不上传,invariant 4 沿用
  // (Web 不碰字节);both key components are validated before derivation.
  async signPhotoSnapshotUpload(
    userId: string,
    albumId: string,
    entries: SnapshotEntry[],
  ): Promise<
    {
      photoId: string;
      renderVersion: string;
      putUrl: string;
      r2Key: string;
      publicUrl: string;
    }[]
  > {
    const { album } = await collaborationService.requireAccess(userId, albumId);
    if (!Array.isArray(entries) || entries.length === 0) {
      throw ERRORS.VALIDATION_FAILED('entries must be a non-empty array');
    }
    if (entries.length > PHOTO_SNAPSHOT_MAX_COUNT) {
      throw ERRORS.VALIDATION_FAILED(`entries must be <= ${PHOTO_SNAPSHOT_MAX_COUNT}`);
    }
    const parsed = SnapshotEntriesSchema.safeParse(entries);
    if (!parsed.success) throw ERRORS.VALIDATION_FAILED('invalid photo snapshot entries');

    const out: {
      photoId: string;
      renderVersion: string;
      putUrl: string;
      r2Key: string;
      publicUrl: string;
    }[] = [];
    for (const { photoId, renderVersion } of parsed.data) {
      const r2Key = photoSnapshotKey(album.userId, albumId, photoId, renderVersion);
      const putUrl = await r2.signPutUrl(r2Key, PHOTO_SNAPSHOT_CONTENT_TYPE, 300);
      out.push({
        photoId,
        renderVersion,
        putUrl,
        r2Key,
        publicUrl: r2.publicUrl(r2Key),
      });
    }
    return out;
  },

  // Browser has finished the direct R2 PUTs; merge successful immutable versions
  // into albums.photo_snapshot under a row lock so partial confirmations cannot
  // drop versions confirmed concurrently.
  // 客户端只把「确实 PUT 成功的」传进来,故这里登记的即真实已备份的。
  async confirmPhotoSnapshot(
    userId: string,
    albumId: string,
    entries: SnapshotEntry[],
  ): Promise<{ photoIds: string[]; renderVersions: Record<string, string> }> {
    return db.transaction(async (tx) => {
      const album = await albumRepo.findByIdForUpdate(tx, albumId);
      if (!album) throw ERRORS.ALBUM_NOT_FOUND();
      const role = await resolveRole(album, userId, tx);
      if (!role) throw COLLAB_ERRORS.ALBUM_ACCESS_DENIED();
      if (!Array.isArray(entries) || entries.length === 0) {
        throw ERRORS.VALIDATION_FAILED('entries must be a non-empty array');
      }
      if (entries.length > PHOTO_SNAPSHOT_MAX_COUNT) {
        throw ERRORS.VALIDATION_FAILED(`entries must be <= ${PHOTO_SNAPSHOT_MAX_COUNT}`);
      }
      const parsed = SnapshotEntriesSchema.safeParse(entries);
      if (!parsed.success) throw ERRORS.VALIDATION_FAILED('invalid photo snapshot entries');

      const merged = mergePhotoSnapshot(
        album.photoSnapshot?.photoIds,
        album.photoSnapshot?.renderVersions,
        parsed.data,
      );
      await albumRepo.update(tx, albumId, {
        photoSnapshot: {
          ...merged,
          updatedAt: new Date().toISOString(),
        },
      });
      return merged;
    });
  },

  // 读已导出 PDF(collab rework §3.2):导出是 Creator 能力,owner/editor 都可读。
  async getPdfUrl(userId: string, albumId: string): Promise<{ pdfUrl: string | null }> {
    const { album } = await collaborationService.requireAccess(userId, albumId);
    return { pdfUrl: album.pdfUrl ?? null };
  },
};

export const albumDB = db;
