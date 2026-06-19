import { db, type DbOrTx } from '@/db/client';
import { albumRepo } from '@/db/repos/album-repo';
import { albumPageRepo } from '@/db/repos/album-page-repo';
import { jobService } from '@/services/job/job-service';
import { draftExpirySweeper } from '@/services/job/draft-expiry-sweeper';
import { r2 } from '@/lib/r2/r2-client';
import { ERRORS } from '@/lib/api/error-codes';
import { getTemplate } from '@yujee/contracts/templates';
import {
  AlbumDraft,
  Page,
  V3LayoutTree,
  V3StoryDraft,
  type ImagePos,
  type Page as V3Page,
  type V3LayoutTree as V3LayoutTreeT,
  type V3StoryProgress,
} from '@yujee/contracts';

const PDF_MAX_BYTES = 50 * 1024 * 1024; // 50MB — docs/web/api.md §3.6
const COVER_THUMB_CONTENT_TYPE = 'image/jpeg';
const COVER_THUMB_MAX_BYTES = 512 * 1024;

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

type StoryProgressState = {
  stage: string;
  chapterOrder: string[];
  doneChapterIds: string[];
  currentChapterId: string | null;
  allDone: boolean;
  exportUnlocked: boolean;
};

function readPreviewPages(draftJson: unknown): V3Page[] | undefined {
  if (!draftJson || typeof draftJson !== 'object' || Array.isArray(draftJson)) return undefined;
  const pages = (draftJson as { pages?: unknown }).pages;
  const parsed = Page.array().safeParse(pages);
  return parsed.success ? parsed.data : undefined;
}

// Parse draft_json into { tree, progress }, tolerating both the bare-tree and the
// wrapped shape. Returns null when draft_json isn't a V3 story draft at all (no
// draft / a v2 AlbumDraft / a finalized album) — callers treat that as "not in the
// story 环节". The initial currentChapterId is the FIRST not-done chapter so a bare
// tree resumes from chapter 1.
function readStoryDraft(draftJson: unknown): NormalizedStoryDraft | null {
  const wrapped = V3StoryDraft.safeParse(draftJson);
  if (wrapped.success) {
    return {
      tree: wrapped.data.tree,
      pages: wrapped.data.pages,
      progress: wrapped.data.progress,
    };
  }

  if (
    draftJson &&
    typeof draftJson === 'object' &&
    !Array.isArray(draftJson) &&
    'version' in draftJson
  ) {
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
    pages: readPreviewPages(draftJson),
    progress: { currentChapterId: firstChapterId, doneChapterIds: [] },
  };
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
    // Theme/cover are downstream optional steps and do not re-lock export, but
    // stage alone is not enough: every current chapter must be done.
    exportUnlocked: allDone && stage !== 'analysing' && stage !== 'story',
  };
}

function assertStoryExportUnlocked(album: Awaited<ReturnType<typeof albumRepo.findById>>): void {
  if (!album) throw ERRORS.ALBUM_NOT_FOUND();
  const normalized = readStoryDraft(album.draftJson);
  // V1/V2/finalized rows do not use the V3 story gate.
  if (!normalized) return;
  if (!storyProgressFrom(album.stage, normalized).exportUnlocked) {
    throw ERRORS.VALIDATION_FAILED('finish all story chapters before export');
  }
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
  // credit; the loser throws ALBUM_NOT_RETRIABLE and generationService.retryV2
  // aborts before the hold. errorMessage is cleared so the album reads clean.
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
    let album = await this.findOwned(userId, albumId);

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
    }

    const pages = await albumPageRepo.findByAlbum(albumId);
    return {
      album: {
        id: album.id,
        title: album.title,
        status: album.status,
        // V3 五环节状态 (WP2.4). Orthogonal to status; the editor reads it to drive
        // the breadcrumb + the story gate. Always present (column default 'analysing').
        stage: album.stage,
        prompt: album.prompt,
        layoutJson: album.layoutJson ?? null,
        photoCount: album.photoCount,
        pageCount: album.pageCount,
        pdfUrl: album.pdfUrl,
        coverThumbnailUrl: album.coverThumbnailUrl,
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
    chapters: { chapterId: string; label: string; role: string; photoIds: string[] }[];
  }> {
    const album = await this.findOwned(userId, albumId);
    const parsed = AlbumDraft.safeParse(album.draftJson);
    if (!parsed.success) return { chapters: [] };
    return {
      chapters: parsed.data.chapters.map((ch) => ({
        chapterId: ch.chapterId,
        label: ch.cluster.label,
        role: ch.cluster.role,
        photoIds: ch.photoIds,
      })),
    };
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
  }> {
    const album = await this.findOwned(userId, albumId);
    return storyProgressFrom(album.stage, readStoryDraft(album.draftJson));
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

      const normalized = readStoryDraft(album.draftJson);
      if (!normalized) throw ERRORS.VALIDATION_FAILED('album has no V3 story draft');

      const chapterOrder = normalized.tree.chapters.map((c) => c.chapterId);
      if (!chapterOrder.includes(chapterId)) {
        throw ERRORS.VALIDATION_FAILED('chapterId not found in draft');
      }

      // The gate already moved past story → nothing to confirm. Surface the current
      // state so the caller is idempotent and never regresses the stage.
      if (album.stage !== 'story') {
        return storyProgressFrom(album.stage, normalized);
      }

      const doneSet = new Set(normalized.progress.doneChapterIds);
      doneSet.add(chapterId);
      const doneChapterIds = chapterOrder.filter((id) => doneSet.has(id));
      const allDone = chapterOrder.every((id) => doneSet.has(id));
      // Next cursor = first chapter (in tree order) not yet done; null when all done.
      const nextCurrent = chapterOrder.find((id) => !doneSet.has(id)) ?? null;

      const nextDraft: V3StoryDraft = {
        version: 'v3-story',
        tree: normalized.tree,
        ...(normalized.pages ? { pages: normalized.pages } : {}),
        progress: { currentChapterId: nextCurrent, doneChapterIds },
      };

      await albumRepo.update(tx, albumId, {
        draftJson: nextDraft,
        // 全章确定 → 进下一环 theme + 解锁导出(§4.2(1) / §4.5a). Only the stage column
        // moves; status stays whatever the init lifecycle left it (EDITING).
        ...(allDone ? { stage: 'theme' as const } : {}),
      });

      return storyProgressFrom(allDone ? 'theme' : album.stage, {
        ...normalized,
        progress: { currentChapterId: nextCurrent, doneChapterIds },
      });
    });
  },

  // Read-only RENDER projection of the authoring tree (draft_json) for the v2
  // authoring flow's skeleton preview (W10 #140). Unlike getChapterSummary this
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
    const album = await this.findOwned(userId, albumId);
    if (album.status !== 'EDITING' || album.layoutJson) return null;
    const parsed = AlbumDraft.safeParse(album.draftJson);
    if (!parsed.success) {
      const normalized = readStoryDraft(album.draftJson);
      if (!normalized?.pages) return null;

      const chapterIdForPage = (page: V3Page): string | null => {
        const refs = new Set(Object.values(page.images));
        const match = normalized.tree.chapters.find((chapter) =>
          chapter.photos.some((photo) => refs.has(photo.photoId)),
        );
        return match?.chapterId ?? null;
      };

      const pages = normalized.pages.map((p, i) => {
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
          kind,
          chapterId: kind === 'chapter' ? chapterIdForPage(p) : null,
        };
      });

      const chapters = normalized.tree.chapters.map((ch, i) => {
        const pageIndexes = pages
          .map((page, idx) => (page.chapterId === ch.chapterId ? idx : -1))
          .filter((idx) => idx >= 0);
        const fallbackStart = Math.min(i + 1, Math.max(pages.length - 1, 0));
        const pageStart = pageIndexes[0] ?? fallbackStart;
        const pageEnd = pageIndexes.length > 0
          ? pageIndexes[pageIndexes.length - 1]! + 1
          : Math.min(pageStart + 1, pages.length);
        return {
          chapterId: ch.chapterId,
          label: `Chapter ${i + 1}`,
          role: i === 0 ? 'opening' as const : i === normalized.tree.chapters.length - 1 ? 'closing' as const : 'body' as const,
          state: 'generated' as const,
          askCount: 0,
          pageStart,
          pageEnd,
        };
      });

      return {
        theme: null,
        style: 'v3',
        language: 'en' as const,
        pages,
        chapters,
      };
    }
    const draft = parsed.data;

    type SkeletonPage = {
      pageIndex: number;
      templateId: string;
      imagesJson: Record<string, string>;
      textsJson: Record<string, string>;
      imagePosJson: Record<string, ImagePos>;
      kind: 'cover' | 'toc' | 'chapter' | 'ending';
      chapterId: string | null;
    };
    const pages: SkeletonPage[] = [];
    const push = (
      p: {
        templateId: string;
        images: Record<string, string>;
        texts: Record<string, string>;
        imagePos?: Record<string, ImagePos>;
      },
      kind: SkeletonPage['kind'],
      chapterId: string | null,
    ) => {
      pages.push({
        pageIndex: pages.length,
        templateId: p.templateId,
        imagesJson: p.images,
        textsJson: p.texts,
        imagePosJson: p.imagePos ?? {},
        kind,
        chapterId,
      });
    };

    push(draft.basePages.cover, 'cover', null);
    if (draft.basePages.toc) push(draft.basePages.toc, 'toc', null);
    const chapters = draft.chapters.map((ch) => {
      const pageStart = pages.length;
      for (const pg of ch.pages) push(pg, 'chapter', ch.chapterId);
      return {
        chapterId: ch.chapterId,
        label: ch.cluster.label,
        role: ch.cluster.role,
        state: ch.state,
        askCount: ch.askCount,
        pageStart,
        pageEnd: pages.length,
      };
    });
    push(draft.basePages.ending, 'ending', null);

    return {
      theme: draft.meta.theme ?? null,
      style: draft.meta.style,
      language: draft.meta.language,
      pages,
      chapters,
    };
  },

  async listByUser(userId: string) {
    const rows = await albumRepo.findByUser(userId);
    const coverRows = await albumPageRepo.findFirstByAlbumIds(rows.map((a) => a.id));
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
    for (const a of rows) {
      let status = a.status;
      if (status === 'AGENT_RUNNING') {
        const resolved = await jobService.resolveGeneration(a.id);
        // A swept zombie is no longer AGENT_RUNNING, but its new status depends on
        // kind (init→FAILED, finalize→back to EDITING), so reload rather than
        // assume FAILED. See jobService.sweepStaleJob.
        if (resolved?.kind === 'swept') {
          const reloaded = await albumRepo.findById(a.id);
          status = reloaded?.status ?? status;
        }
      } else if (status === 'EDITING') {
        // Read-time draft-expiry sweep (§12): landing on /my-albums is enough to
        // release an idle draft's hold past 24h. The album stays EDITING (the
        // draft is kept), so status is unaffected — only the credit hold moves.
        await draftExpirySweeper.sweepAlbumOnRead(a.id);
      }
      out.push({
        id: a.id,
        title: a.title,
        status,
        photoCount: a.photoCount,
        pageCount: a.pageCount,
        pdfUrl: a.pdfUrl,
        coverThumbnailUrl: a.coverThumbnailUrl ?? null,
        createdAt: a.createdAt,
        coverPage: coverByAlbumId.get(a.id) ?? null,
      });
    }
    return out;
  },

  // Hard delete. FK ON DELETE CASCADE drops pages / messages / jobs / holds in
  // the same statement; credit_ledger.related_album_id is set null so the audit
  // trail survives. A still-HOLDING hold never debited the balance, so removing
  // it strands no credit.
  async delete(userId: string, albumId: string): Promise<void> {
    await this.findOwned(userId, albumId);
    await albumRepo.delete(db, albumId);
  },

  // Editor saves a single page (docs/web/api.md §3.5). The whole layout_json is
  // owned by generation/chat; direct edits only touch the per-page row.
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
    },
  ): Promise<{ updated: true }> {
    await this.findOwned(userId, albumId);
    await db.transaction(async (tx) => {
      await albumPageRepo.updateOne(tx, albumId, pageIndex, patch);
    });
    return { updated: true };
  },

  // Editor renames the album from the topbar (docs/web/api.md §1 — PATCH base
  // fields). Only the title is mutable here; layout/status are owned by
  // generation/chat/pdf flows. Ownership is enforced before the write.
  async updateTitle(userId: string, albumId: string, title: string): Promise<{ title: string }> {
    await this.findOwned(userId, albumId);
    const trimmed = title.trim();
    if (!trimmed) throw ERRORS.VALIDATION_FAILED('title must not be empty');
    await db.transaction(async (tx) => {
      await albumRepo.update(tx, albumId, { title: trimmed });
    });
    return { title: trimmed };
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

    const album = await this.findOwned(userId, albumId);
    assertStoryExportUnlocked(album);

    const r2Key = `pdfs/${userId}/${albumId}.pdf`;
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
    const album = await this.findOwned(userId, albumId);
    assertStoryExportUnlocked(album);
    const expected = `pdfs/${userId}/${albumId}.pdf`;
    if (r2Key !== expected) throw ERRORS.VALIDATION_FAILED('r2Key does not match album');

    const pdfUrl = r2.publicUrl(r2Key);
    await db.transaction(async (tx) => {
      await albumRepo.update(tx, albumId, { pdfR2Key: r2Key, pdfUrl, status: 'COMPLETED' });
    });
    return { pdfUrl };
  },

  async signCoverThumbnailUpload(
    userId: string,
    albumId: string,
    input: { contentType: string; size: number },
  ): Promise<{ putUrl: string; r2Key: string; publicUrl: string }> {
    if (input.contentType !== COVER_THUMB_CONTENT_TYPE) {
      throw ERRORS.VALIDATION_FAILED('contentType must be image/jpeg');
    }
    if (input.size <= 0 || input.size > COVER_THUMB_MAX_BYTES) {
      throw ERRORS.VALIDATION_FAILED('cover thumbnail must be <= 512KB');
    }

    await this.findOwned(userId, albumId);

    const r2Key = `cover-thumbs/${userId}/${albumId}.jpg`;
    const putUrl = await r2.signPutUrl(r2Key, input.contentType, 300);
    return { putUrl, r2Key, publicUrl: r2.publicUrl(r2Key) };
  },

  async confirmCoverThumbnail(
    userId: string,
    albumId: string,
    r2Key: string,
  ): Promise<{ coverThumbnailUrl: string }> {
    await this.findOwned(userId, albumId);
    const expected = `cover-thumbs/${userId}/${albumId}.jpg`;
    if (r2Key !== expected) throw ERRORS.VALIDATION_FAILED('r2Key does not match album');

    const coverThumbnailUrl = `${r2.publicUrl(r2Key)}?v=${Date.now()}`;
    await db.transaction(async (tx) => {
      await albumRepo.update(tx, albumId, {
        coverThumbnailR2Key: r2Key,
        coverThumbnailUrl,
      });
    });
    return { coverThumbnailUrl };
  },

  async getPdfUrl(userId: string, albumId: string): Promise<{ pdfUrl: string | null }> {
    const album = await this.findOwned(userId, albumId);
    return { pdfUrl: album.pdfUrl ?? null };
  },
};

export const albumDB = db;
