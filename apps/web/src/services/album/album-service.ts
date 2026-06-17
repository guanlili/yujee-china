import { db, type DbOrTx } from '@/db/client';
import { albumRepo } from '@/db/repos/album-repo';
import { albumPageRepo } from '@/db/repos/album-page-repo';
import { jobService } from '@/services/job/job-service';
import { draftExpirySweeper } from '@/services/job/draft-expiry-sweeper';
import { r2 } from '@/lib/r2/r2-client';
import { ERRORS } from '@/lib/api/error-codes';
import { AlbumDraft, type ImagePos } from '@yujee/contracts';

const PDF_MAX_BYTES = 50 * 1024 * 1024; // 50MB — docs/web/api.md §3.6
// #167: cover thumbnail is a downscaled JPEG (~480px wide). A few hundred KB is a
// generous ceiling; anything larger means the browser sent the wrong asset.
const COVER_THUMB_MAX_BYTES = 2 * 1024 * 1024; // 2MB
const COVER_THUMB_CONTENT_TYPE = 'image/jpeg';

type AlbumCoverPage = {
  pageIndex: number;
  templateId: string;
  imagesJson: Record<string, string>;
  textsJson: Record<string, string>;
  imagePosJson: Record<string, ImagePos>;
};

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
        prompt: album.prompt,
        layoutJson: album.layoutJson ?? null,
        photoCount: album.photoCount,
        pageCount: album.pageCount,
        pdfUrl: album.pdfUrl,
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
    if (!parsed.success) return null;
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
        createdAt: a.createdAt,
        // #167: persistent cover thumbnail (rasterized first page in R2). Preferred
        // by the card over re-rendering from the non-persistent browser photoStore.
        coverThumbnailUrl: a.coverThumbnailUrl ?? null,
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

    await this.findOwned(userId, albumId);

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
    await this.findOwned(userId, albumId);
    const expected = `pdfs/${userId}/${albumId}.pdf`;
    if (r2Key !== expected) throw ERRORS.VALIDATION_FAILED('r2Key does not match album');

    const pdfUrl = r2.publicUrl(r2Key);
    await db.transaction(async (tx) => {
      await albumRepo.update(tx, albumId, { pdfR2Key: r2Key, pdfUrl, status: 'COMPLETED' });
    });
    return { pdfUrl };
  },

  async getPdfUrl(userId: string, albumId: string): Promise<{ pdfUrl: string | null }> {
    const album = await this.findOwned(userId, albumId);
    return { pdfUrl: album.pdfUrl ?? null };
  },

  // #167: sign a direct R2 PUT for the cover thumbnail (the browser-rasterized
  // first page). Same posture as signPdfUpload — Web never touches the bytes
  // (invariant 4), and this is a rendered derivative, not an original photo
  // (invariant 1/2). The key is namespaced to {userId}/{albumId} so a forged key
  // can't write into another album's slot.
  async signCoverThumbnailUpload(
    userId: string,
    albumId: string,
    input: { contentType: string; size: number },
  ): Promise<{ putUrl: string; r2Key: string; publicUrl: string }> {
    if (input.contentType !== COVER_THUMB_CONTENT_TYPE) {
      throw ERRORS.VALIDATION_FAILED('contentType must be image/jpeg');
    }
    if (input.size <= 0 || input.size > COVER_THUMB_MAX_BYTES) {
      throw ERRORS.VALIDATION_FAILED('cover thumbnail size out of range');
    }

    await this.findOwned(userId, albumId);

    const r2Key = `cover-thumbs/${userId}/${albumId}.jpg`;
    const putUrl = await r2.signPutUrl(r2Key, input.contentType, 300);
    return { putUrl, r2Key, publicUrl: r2.publicUrl(r2Key) };
  },

  // #167: browser finished the direct R2 PUT of the cover thumbnail; record the
  // key + public URL on the album. No status change — a thumbnail can be (re)written
  // at finalize/export time or when the editor reopens, regardless of album status.
  // The key must match the {userId}/{albumId} namespace signCoverThumbnailUpload
  // issued, rejecting a forged key for another album. A cache-busting query is
  // appended to coverThumbnailUrl so a re-uploaded thumbnail (same R2 key) is not
  // served stale from the browser/CDN cache.
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
};

export const albumDB = db;
