import { eq } from 'drizzle-orm';
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

export type LoadedDraft = DraftEnvelope & { pages: Page[]; revision: number };

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
  if (rowCount > 0) {
    const rows = await draftPageRepo.findByAlbum(album.id, tx);
    pages = rows.map((row) => row.page);
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
  await tx.update(albums).set({ draftRevision: 1 }).where(eq(albums.id, album.id));
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
export async function bumpDraftRevision(tx: DbOrTx, albumId: string, current: number): Promise<number> {
  const next = current + 1;
  await tx.update(albums).set({ draftRevision: next }).where(eq(albums.id, albumId));
  return next;
}
