import { eq, sql } from 'drizzle-orm';
import { Page, V3LayoutTree, V3StoryDraft, type V3LayoutTree as V3LayoutTreeT, type V3StoryProgress } from '@yujee/contracts';
import { db, type DbOrTx } from '@/db/client';
import { albums, type Album } from '@/db/schema';
import { draftPageRepo } from '@/db/repos/draft-page-repo';
import { logger } from '@/lib/log/logger';
import { bakePagesHtml, type BakeablePage } from './bake-html';

// draft_pages 拆表(Phase 1a) — the only draft access layer
// (docs/plans/2026-08-03-draft-pages-split.md). Reads prefer the per-page
// `draft_pages` rows and fall back read-only to legacy `draftJson.pages` when
// an album has no rows yet; writers (Task 3+) seed rows lazily under the
// album row lock before writing.

export type DraftEnvelope = {
  tree: V3LayoutTreeT;
  progress: V3StoryProgress;
  design?: Record<string, unknown>;
};

// 页行的协同元数据(collab plan §7.3)。**必须与 `pages` 出自同一次读** ——
// 分两次读 draft_pages 会让调用方拿到「旧内容 + 新 version」:客户端带着这个
// version 保存,服务端预比较与条件更新都会放行,于是静默覆盖掉一份它从未见过
// 的修改。OCC 的全部意义就是防这件事,读路径不能自己把它捅穿。
// 未播种(legacy 回退)时为空 Map,调用方投影成 null。
export type DraftPageMeta = { version: number; updatedBy: string | null; updatedAt: Date };
export type LoadedDraft = DraftEnvelope & {
  pages: Page[];
  revision: number;
  meta: Map<number, DraftPageMeta>;
};

// Pure: pulls the legacy preview-pages array straight off `draftJson.pages`,
// no baking, no DB access. Used both as the count===0 read fallback here and
// (re-exported) by `album-service.readStoryDraft`'s bare-tree branch and by
// `share-service.ts`'s frozen-share read.
export function readPreviewPages(draftJson: unknown): Page[] | undefined {
  if (!draftJson || typeof draftJson !== 'object' || Array.isArray(draftJson)) return undefined;
  const pages = (draftJson as { pages?: unknown }).pages;
  const parsed = Page.array().safeParse(pages);
  return parsed.success ? parsed.data : undefined;
}

// Pure envelope parse: {tree, progress, design}, deliberately WITHOUT pages
// (pages live in draft_pages / legacy draftJson.pages, resolved separately by
// the caller). Tolerates both the wrapped `V3StoryDraft` shape and the bare
// `V3LayoutTree` shape WP1.5 originally wrote (bare tree => progress starts
// at the first chapter, done set empty). Returns null when draftJson is
// neither — same "unparseable" condition `album-service.readStoryDraft` has
// always used, extracted here so `loadStoryDraft` can reuse it verbatim.
export function parseDraftEnvelope(draftJson: unknown): DraftEnvelope | null {
  const wrapped = V3StoryDraft.safeParse(draftJson);
  if (wrapped.success) {
    return {
      tree: wrapped.data.tree,
      progress: wrapped.data.progress,
      design: wrapped.data.design,
    };
  }

  if (
    draftJson &&
    typeof draftJson === 'object' &&
    !Array.isArray(draftJson) &&
    'version' in draftJson
  ) {
    // Has a `version` key but failed the wrapped schema => a corrupt/unknown
    // wrapped draft, not a bare tree to fall back on.
    return null;
  }

  const treeCandidate =
    draftJson && typeof draftJson === 'object' && !Array.isArray(draftJson) && 'chapters' in draftJson
      ? { chapters: (draftJson as { chapters?: unknown }).chapters }
      : draftJson;
  const bare = V3LayoutTree.safeParse(treeCandidate);
  if (!bare.success) return null;
  const tree = bare.data;
  const firstChapterId = tree.chapters[0]?.chapterId ?? null;
  return {
    tree,
    progress: { currentChapterId: firstChapterId, doneChapterIds: [] },
  };
}

// Read: rows preferred; falls back read-only to legacy draftJson.pages when
// the album has zero draft_pages rows (never seeds — that's
// ensureDraftPagesSeeded's job, called from write paths only).
// `bake` defaults to true (lenient re-bake on read, never written back); the
// share freeze path passes `{ bake: false }` to preserve pages byte-for-byte.
// `album` is the already-read albums row (avoids a redundant query); pass
// `tx` when calling inside a row-lock transaction so reads see locked state.
//
// null 语义:envelope 无法解析(parseDraftEnvelope 失败)即 null — this is the
// ONLY null condition, independent of whether draft_pages rows exist. We
// never fabricate a `tree`/`progress` (both required on `DraftEnvelope`); a
// fabricated empty tree would silently corrupt chapter-attribution logic
// downstream, so loud absence beats quiet wrongness. If rows DID exist at
// that point, this is a data-integrity anomaly (draftJson desynced from
// draft_pages) — we log it via `logger.error` before returning null, and we
// never touch the rows (no write, no delete): they stay intact for manual
// repair. When there are no rows either, this is just the ordinary "no draft
// at all yet" case and nothing is logged.
export async function loadStoryDraft(
  album: Album,
  opts?: { bake?: boolean; tx?: DbOrTx },
): Promise<LoadedDraft | null> {
  const tx = opts?.tx ?? db;
  const bake = opts?.bake ?? true;

  const envelope = parseDraftEnvelope(album.draftJson);
  if (!envelope) {
    const rowCount = await draftPageRepo.countByAlbum(album.id, tx);
    if (rowCount > 0) {
      logger.error(
        { albumId: album.id, rowCount },
        'draft envelope unparseable but draft_pages rows exist',
      );
    }
    return null;
  }

  const rowCount = await draftPageRepo.countByAlbum(album.id, tx);
  let pages: Page[];
  // 一次读派生两样东西:页内容与它们的 version/updatedBy/updatedAt。绝不能为了
  // 拿 meta 再读一次 draft_pages —— 两次读之间落一次写就会内容与版本错位。
  const meta = new Map<number, DraftPageMeta>();
  if (rowCount > 0) {
    const rows = await draftPageRepo.findByAlbum(album.id, tx);
    pages = rows.map((row) => row.page);
    for (const row of rows) {
      meta.set(row.pageIndex, {
        version: row.version,
        updatedBy: row.updatedBy,
        updatedAt: row.updatedAt,
      });
    }
  } else {
    pages = readPreviewPages(album.draftJson) ?? [];
  }
  if (bake) {
    pages = bakePagesHtml(pages as BakeablePage[], { strict: false }) as Page[];
  }

  return {
    tree: envelope.tree,
    progress: envelope.progress,
    design: envelope.design,
    pages,
    revision: album.draftRevision,
    meta,
  };
}

// Write-before seeding: call under the album row lock, before any row-level
// write. Rows already exist => no-op, return the current revision. No rows
// but legacy draftJson.pages has content => copy it into draft_pages verbatim
// (no baking — seeding just relocates existing bytes; `loadStoryDraft` bakes
// lazily on read), stamp every seeded row `version = 1`, set
// `albums.draft_revision = 1`, return 1. Neither rows nor legacy pages =>
// nothing to seed, return the current (unchanged) revision.
export async function ensureDraftPagesSeeded(tx: DbOrTx, album: Album): Promise<number> {
  const rowCount = await draftPageRepo.countByAlbum(album.id, tx);
  if (rowCount > 0) return album.draftRevision;

  const legacyPages = readPreviewPages(album.draftJson);
  if (!legacyPages || legacyPages.length === 0) return album.draftRevision;

  await draftPageRepo.replaceAll(tx, album.id, legacyPages, 1, null);
  // 播种是整批写入(collab plan §7.4 写点清单):结构版本同步推进,让基于
  // revision 0(空书)的旧客户端在播种后收到 reloadRequired 而非错误增量。
  // GREATEST 而不是硬写 1:OCC 用的是**相等**比较,结构版本一旦回退,陈旧基线
  // 就会被判成新鲜而放行。当前推不出 rowCount === 0 且 structureRevision > 1 的
  // 状态,但单调性是 OCC 的前提,值得用一行 SQL 钉死而不是靠推理维持。
  await tx
    .update(albums)
    .set({
      draftRevision: 1,
      draftStructureRevision: sql`GREATEST(${albums.draftStructureRevision}, 1)`,
    })
    .where(eq(albums.id, album.id));
  return 1;
}

// envelope 写助手:只写 {version:'v3-story', tree, progress, design} — pages
// NEVER goes back into draftJson from a write path built on this helper (the
// per-page truth lives in draft_pages from here on).
export function envelopeJson(env: DraftEnvelope): Record<string, unknown> {
  const json: Record<string, unknown> = {
    version: 'v3-story',
    tree: env.tree,
    progress: env.progress,
  };
  if (env.design !== undefined) json.design = env.design;
  return json;
}

// revision 推进助手: returns the next revision and UPDATEs ONLY
// albums.draft_revision (no updatedAt/other columns — the caller's own
// albumRepo.update/transitionStatus call in the same write transaction is
// what advances updatedAt).
//
// `{ structural: true }`(collab plan §7.4)供整批/结构写点使用:推进
// draft_revision 的同时把 draft_structure_revision 也钉到新值 —— 页面集合可能
// 删行/重排,增量同步必须让旧客户端整书重载。普通单页写(updatePage、
// repair-mag09)不传,只推进 draft_revision。分类清单:replaceAll 的全部调用点
// (select-layout / append compose / full compose / design-chat / placeholder
// design / reorder / deletePage / 播种)都是 structural。
export async function bumpDraftRevision(
  tx: DbOrTx,
  albumId: string,
  current: number,
  opts?: { structural?: boolean },
): Promise<number> {
  const next = current + 1;
  await tx
    .update(albums)
    .set(opts?.structural ? { draftRevision: next, draftStructureRevision: next } : { draftRevision: next })
    .where(eq(albums.id, albumId));
  return next;
}
