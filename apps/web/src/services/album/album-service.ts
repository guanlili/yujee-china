import { db, type DbOrTx } from '@/db/client';
import { albumRepo } from '@/db/repos/album-repo';
import { albumPageRepo } from '@/db/repos/album-page-repo';
import { jobService } from '@/services/job/job-service';
import { draftExpirySweeper } from '@/services/job/draft-expiry-sweeper';
import { agentClient } from '@/lib/agent/agent-client';
import { r2 } from '@/lib/r2/r2-client';
import { ERRORS } from '@/lib/api/error-codes';
import { getTemplate } from '@yujee/contracts/templates';
import {
  AlbumDraft,
  Page,
  V3LayoutTree,
  V3StoryDraft,
  type AlbumLayoutPlan,
  type ImagePos,
  type Page as V3Page,
  type V3LayoutTree as V3LayoutTreeT,
  type V3Language,
  type V3StoryProgress,
  type V3ChapterThemeChoice,
  type V3LayoutPatchEntry,
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
      const currentChapterId = chapterOrder.find((id) => !doneSet.has(id)) ?? null;
      if (!doneSet.has(chapterId) && chapterId !== currentChapterId) {
        throw ERRORS.VALIDATION_FAILED('chapterId is not the current story chapter');
      }

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

  // ③ 主题/章节色-应用 (WP3.2 / #190). The user picked, per chapter, one
  // {accentColor, artFont}; this WRITES them into the tree's V3Chapter nodes (where
  // the chapter color/font live until finalize bakes them — §3 树边界: the flat
  // render contract gains no tree-shaped field), and advances albums.stage
  // theme → cover. The Agent already produced the deterministic page-level
  // `layoutPatch` (one-click 刷 variableDecor 槽, 含 SVG) — Web is the sole truth
  // source, so we persist the tree colors + advance stage here and hand the patch back
  // for the browser to apply live (pages are re-derived/merged at finalize, not stored
  // in draft_json). stage ⟂ status (§6.8 第 4 条): only the stage column moves; status
  // stays EDITING. Idempotent: re-applying (or applying after cover) only ever advances
  // theme → cover, never regresses, so a double-submit is safe. Caller must hold
  // ownership (findOwned) before invoking.
  async applyTheme(
    userId: string,
    albumId: string,
    chapters: V3ChapterThemeChoice[],
    layoutPatch: V3LayoutPatchEntry[],
  ): Promise<{ stage: string; layoutPatch: V3LayoutPatchEntry[] }> {
    const album = await this.findOwned(userId, albumId);
    const normalized = readStoryDraft(album.draftJson);
    if (!normalized) throw ERRORS.VALIDATION_FAILED('album has no V3 story draft');

    const expectedChapterIds = normalized.tree.chapters.map((ch) => ch.chapterId);
    const expectedSet = new Set(expectedChapterIds);
    const seen = new Set<string>();
    for (const choice of chapters) {
      if (seen.has(choice.chapterId)) {
        throw ERRORS.VALIDATION_FAILED('duplicate chapterId in theme choices');
      }
      if (!expectedSet.has(choice.chapterId)) {
        throw ERRORS.VALIDATION_FAILED('chapterId not found in draft');
      }
      seen.add(choice.chapterId);
    }
    if (seen.size !== expectedChapterIds.length) {
      throw ERRORS.VALIDATION_FAILED('theme choices must cover every chapter');
    }

    // Write each chosen {accentColor, artFont} onto its chapter node in the tree.
    const choiceById = new Map(chapters.map((c) => [c.chapterId, c]));
    const nextTree: typeof normalized.tree = {
      chapters: normalized.tree.chapters.map((ch) => {
        const choice = choiceById.get(ch.chapterId);
        return choice
          ? { ...ch, accentColor: choice.accentColor, artFont: choice.artFont }
          : ch;
      }),
    };

    const nextDraft: V3StoryDraft = {
      version: 'v3-story',
      tree: nextTree,
      ...(normalized.pages ? { pages: normalized.pages } : {}),
      progress: normalized.progress,
    };

    // Advance theme → cover only (the theme 环节 is done). From any other stage this
    // is a no-op on the stage column (idempotent; never regresses past cover).
    const advanceStage = album.stage === 'theme';

    await db.transaction(async (tx) => {
      await albumRepo.update(tx, albumId, {
        draftJson: nextDraft,
        ...(advanceStage ? { stage: 'cover' as const } : {}),
      });
    });

    return {
      stage: advanceStage ? 'cover' : album.stage,
      layoutPatch,
    };
  },

  // ④ 书籍设计 — 封面/封尾 (WP4.1 #192). After the user (optionally) picks a 封面/封尾
  // system template, the Agent deterministically auto-fills the relevant pages and
  // returns a page-level `layoutPatch` (§3 树边界: 仍是页级 — cover/ending design is a
  // flat layout patch, NOT a tree field, so nothing is written into draft_json's tree;
  // pages are re-derived/merged at finalize). Web is the sole truth source for stage,
  // so this advances albums.stage cover → ready (§8.3 stage 推进权在 Web) and hands the
  // patch back for the browser to apply live. Cover is OPTIONAL (§4.4): a skip yields an
  // empty patch, and the stage still advances cover → ready (主题/封面不卡导出 — §4.5a:
  // the export gate already opened at story完成; 封面 is never a gate). stage ⟂ status
  // (§6.8 第 4 条): only the stage column moves; status stays EDITING. Idempotent:
  // re-applying (or applying after ready) only ever advances cover → ready, never
  // regresses, so a double-submit is safe. Caller must hold ownership (findOwned).
  async cover(
    userId: string,
    albumId: string,
    layoutPatch: V3LayoutPatchEntry[],
  ): Promise<{ stage: string; layoutPatch: V3LayoutPatchEntry[] }> {
    const album = await this.findOwned(userId, albumId);

    // Advance cover → ready only (the 书籍设计 环节 is done). From any other stage this
    // is a no-op on the stage column (idempotent; never regresses past ready). We accept
    // 'theme' too so a user who skipped straight through theme→cover→ready isn't stuck:
    // the only stages BEFORE the design step are 'analysing'/'story', which gate export
    // and must NOT be jumped by a cover call; 'theme'/'cover' may advance to 'ready'.
    const advanceStage = album.stage === 'cover' || album.stage === 'theme';

    if (advanceStage) {
      await db.transaction(async (tx) => {
        await albumRepo.update(tx, albumId, { stage: 'ready' as const });
      });
    }

    return {
      stage: advanceStage ? 'ready' : album.stage,
      layoutPatch,
    };
  },

  // ⑤ 待导出 — finalize (WP5.1 #194). Flattens the V3 authoring tree (draft_json) +
  // the current pages into the external render contract `AlbumLayoutPlan`
  // (magazine+photos+pages[]) the browser turns into a PDF. The WHOLE tree is read
  // SERVER-SIDE here (§8.3 全树只在 finalize 传一次; invariant 12: the tree never
  // round-trips through the browser) — only the UI `language` scalar comes from the
  // caller. The Agent is stateless + deterministic (no model): it bakes each chapter's
  // accentColor/artFont (incl. the svg seam) into the flat pages[].texts (§3 树边界:
  // 渲染契约不加树形字段) and runs the SINGLE validate (§6.8 第 7 条). finalize does NOT
  // advance stage and NEVER touches creditService (积分 changes are atomic with status
  // at init, §6.7 — out of scope here); it is a pure read → flatten projection. Caller
  // must hold ownership (findOwned). Returns the flat定稿 for the browser to render.
  async finalize(
    userId: string,
    albumId: string,
    language: V3Language,
  ): Promise<{ layout: AlbumLayoutPlan }> {
    const album = await this.findOwned(userId, albumId);
    const normalized = readStoryDraft(album.draftJson);
    if (!normalized) throw ERRORS.VALIDATION_FAILED('album has no V3 story draft');

    const rows = await albumPageRepo.findByAlbum(albumId);
    if (rows.length === 0) throw ERRORS.VALIDATION_FAILED('album has no pages to finalize');
    const pages: V3Page[] = rows.map((p) => {
      // album_pages json columns are stored as jsonb (unknown at the type level);
      // the writers persist the Page-shaped maps, so we narrow to the contract types.
      const imagePos = p.imagePosJson as Record<string, ImagePos>;
      return {
        pageIndex: p.pageIndex,
        templateId: p.templateId,
        images: p.imagesJson as Record<string, string>,
        texts: p.textsJson as Record<string, string>,
        ...(imagePos && Object.keys(imagePos).length > 0 ? { imagePos } : {}),
      };
    });

    // Deterministic flatten + bake + single-validate (no base64; tree carries no images).
    const result = await agentClient.finalizeV3({
      albumId,
      language,
      tree: normalized.tree,
      pages,
    });

    return { layout: result.layout };
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
