import { bakePageHtml, bakePagesHtml, type BakeablePage } from './bake-html';
import { patchHtmlText } from '@/components/album/page-html-dom';
import { db, type DbOrTx } from '@/db/client';
import { albumRepo } from '@/db/repos/album-repo';
import { albumMessageRepo } from '@/db/repos/album-message-repo';
import { albumPageRepo } from '@/db/repos/album-page-repo';
import { jobService } from '@/services/job/job-service';
import { draftExpirySweeper } from '@/services/job/draft-expiry-sweeper';
import { agentClient } from '@/lib/agent/agent-client';
import { designAgentClient } from '@/lib/agent/design-agent-client';
import { r2 } from '@/lib/r2/r2-client';
import { ERRORS } from '@/lib/api/error-codes';
import { getTemplate } from '@yujee/contracts/templates';
import { transientPagePhotoRefs } from './page-photo-refs';
import { assembleDesignedPages, buildCoverSets, pickHeroPhotos, slotSpecs, templateCategory } from './design-apply';
import {
  Page,
  V3LayoutTree,
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

function readPreviewPages(draftJson: unknown): V3Page[] | undefined {
  if (!draftJson || typeof draftJson !== 'object' || Array.isArray(draftJson)) return undefined;
  const pages = (draftJson as { pages?: unknown }).pages;
  const parsed = Page.array().safeParse(pages);
  return parsed.success ? parsed.data : undefined;
}

// Parse draft_json into { tree, progress }, tolerating both the bare-tree and the
// wrapped shape. Returns null when draft_json isn't a V3 story draft at all (no
// draft / finalized album). The initial currentChapterId is the FIRST not-done
// chapter so a bare tree resumes from chapter 1.
function readStoryDraft(draftJson: unknown): NormalizedStoryDraft | null {
  const wrapped = V3StoryDraft.safeParse(draftJson);
  if (wrapped.success) {
    return {
      tree: wrapped.data.tree,
      // C 方案读路径兜底:存量 draft(烘 HTML 上线前落库)的页缺 html,读出时
      // 现场烘一遍(不回写库;之后任何写路径落库即固化)。lenient 见 bake-html。
      pages: wrapped.data.pages
        ? (bakePagesHtml(wrapped.data.pages as BakeablePage[], { strict: false }) as typeof wrapped.data.pages)
        : wrapped.data.pages,
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

function assertStoryExportUnlocked(album: Awaited<ReturnType<typeof albumRepo.findById>>): void {
  if (!album) throw ERRORS.ALBUM_NOT_FOUND();
  const normalized = readStoryDraft(album.draftJson);
  // V1/V2/finalized rows do not use the V3 story gate.
  if (!normalized) return;
  if (!storyProgressFrom(album.stage, normalized).exportUnlocked) {
    throw ERRORS.VALIDATION_FAILED('finish all story chapters and the design step before export');
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
      // 解耦后 select-layout 是独立 layout job,相册仍是 EDITING。若有在跑的 layout job,把它的
      // stage/progress 透出 —— 两段式 poll 靠此看到 candidates-ready 哨兵(stage=layout,progress=52)
      // 并驱动 phase 2(渲染缩略图→judge-layout)。非 layout 的残留 job 不透出。
      const resolved = await jobService.resolveGeneration(albumId);
      if (resolved?.kind === 'progress' && resolved.stage === 'layout') {
        generation = { stage: resolved.stage, progress: resolved.progress };
      }
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
    chapters: { chapterId: string; label: string; role: string; photoIds: string[]; chapterContext: string }[];
  }> {
    const album = await this.findOwned(userId, albumId);
    const normalized = readStoryDraft(album.draftJson);
    if (!normalized) return { chapters: [] };
    const last = normalized.tree.chapters.length - 1;
    return {
      chapters: normalized.tree.chapters.map((ch, i) => ({
        chapterId: ch.chapterId,
        label: ch.description || `Group ${i + 1}`,
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
    const normalized = readStoryDraft(album.draftJson);
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
        .map((chapter) => {
          const pageIndexes = (normalized.pages ?? [])
            .filter((page) => chapterIdForDraftPage(normalized, page) === chapter.chapterId)
            .map((page) => page.pageIndex);
          const haystack = [chapter.description, ...chapter.photoDescs].join(' ').toLowerCase();
          const score = haystack.split(query).length - 1;
          return {
            chapterId: chapter.chapterId,
            pageIndexes,
            label: chapter.description || chapter.chapterId,
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
      const chapters = normalized.tree.chapters.map((chapter) => {
        const pageIndexes = pages
          .filter((page) => chapterIdForDraftPage(normalized, page) === chapter.chapterId)
          .map((page) => page.pageIndex);
        return {
          chapterId: chapter.chapterId,
          label: chapter.description || chapter.chapterId,
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

  // ②b 设计 Agent 全书对话（packages/design-agent album server）。每轮先把 draft 的
  // tree+pages 装进 Agent 画布（Web/Postgres 永远是书的真相源），再发对话；Agent 的
  // 写入工具只改它画布里的书，Web 拿回 pages 逐页过 contracts Page strict 校验后
  // 整替 draft_json.pages。读-答轮次（committed=false）不落库。
  async designChatTurn(
    userId: string,
    albumId: string,
    input: { userMessage: string; currentPageIndex?: number },
  ): Promise<{ assistantReply: string; committed: boolean; pageCount: number }> {
    await this.prepareDesignChat(userId, albumId);
    const result = await designAgentClient.chat(albumId, input.userMessage, input.currentPageIndex);
    await this.persistDesignChat(userId, albumId, {
      userMessage: input.userMessage,
      assistantReply: result.assistantReply,
      committed: result.committed,
      pages: result.book.pages,
    });
    return {
      assistantReply: result.assistantReply,
      committed: result.committed,
      pageCount: result.book.pages.length,
    };
  },

  // 装书前置：所有权校验 + draft 校验 + 把当前书推给设计 Agent。流式与同步两条
  // 路径共用。
  async prepareDesignChat(userId: string, albumId: string): Promise<void> {
    const album = await this.findOwned(userId, albumId);
    const normalized = readStoryDraft(album.draftJson);
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
    await designAgentClient.loadBook(albumId, {
      chapters: normalized.tree.chapters,
      pages: normalized.pages,
      brief: {
        theme: [album.title, album.prompt].filter(Boolean).join(' — ').slice(0, 200) || undefined,
        ...(design ? { palette: { fonts: design.fonts, colors: design.colors } } : {}),
        ...(coverMood ? { coverMood } : {}),
      },
    });
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
    },
  ): Promise<void> {
    if (input.committed) {
      const pages = input.pages.map((page) => Page.parse(page));
      await db.transaction(async (tx) => {
        const latest = await albumRepo.findByIdForUpdate(tx, albumId);
        if (!latest) throw ERRORS.ALBUM_NOT_FOUND();
        const current = readStoryDraft(latest.draftJson);
        if (!current?.pages) throw ERRORS.VALIDATION_FAILED('album has no V3 story draft pages');
        const nextDraft: V3StoryDraft = {
          version: 'v3-story',
          tree: current.tree,
          pages,
          progress: current.progress,
        };
        await albumRepo.update(tx, albumId, { draftJson: nextDraft });
      });
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
    const album = await this.findOwned(userId, albumId);
    const normalized = readStoryDraft(album.draftJson);
    if (!normalized) throw ERRORS.VALIDATION_FAILED('album has no V3 story draft');

    const expectedIds = new Set(normalized.tree.chapters.map((ch) => ch.chapterId));
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

    const nextTree: typeof normalized.tree = {
      chapters: normalized.tree.chapters.map((ch) => {
        const update = byId.get(ch.chapterId);
        if (update === undefined) return ch;
        return {
          ...ch,
          chapterContext: update.chapterContext,
          ...(update.place !== undefined ? { place: update.place } : {}),
        };
      }),
    };

    const nextDraft: V3StoryDraft = {
      version: 'v3-story',
      tree: nextTree,
      ...(normalized.pages ? { pages: normalized.pages } : {}),
      progress: normalized.progress,
    };

    await db.transaction(async (tx) => {
      await albumRepo.update(tx, albumId, { draftJson: nextDraft });
      // 采访问答进 album_messages(带 chapterId),供 loadHistory 按 seq 顺序重建。只存该章存在
      // 的消息。顺序由 repo.create 分配的单调 seq 保证(写入顺序 = 回放顺序),不再手工错开
      // createdAt —— 「问1→问2→问3→答」按这里的循环顺序落库即可。
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
    });

    return { savedChapterIds: [...seen] };
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
    const album = await this.findOwned(userId, albumId);
    // 时序反转:排版前(analyze 完、还没 select-layout)也要能拿 skeleton 去走「收集故事」面板。
    // 那时 album.status='EDITING'(analyze 完成后保持 EDITING,不翻 AGENT_RUNNING)、layoutJson=null、
    // draftJson 有 tree 无 pages。status 允许 EDITING/AGENT_RUNNING(后者兼容老时序),
    // layoutJson 仍必须为 null(排版完/定稿走另一路)。
    if ((album.status !== 'EDITING' && album.status !== 'AGENT_RUNNING') || album.layoutJson) return null;
    const normalized = readStoryDraft(album.draftJson);
    if (!normalized) return null;
    // 排版前 pages 尚不存在 —— 用空数组,chapters 仍从 tree 出(带 photoIds),让收集面板可用。
    const draftPages = normalized.pages ?? [];

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
        label: `Group ${i + 1}`,
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
        // A swept zombie is no longer AGENT_RUNNING, so reload instead of relying
        // on the stale list row.
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
      const coverPage = coverByAlbumId.get(a.id) ?? null;
      out.push({
        id: a.id,
        title: a.title,
        status,
        photoCount: a.photoCount,
        pageCount: a.pageCount,
        pdfUrl: a.pdfUrl,
        coverThumbnailUrl: a.coverThumbnailUrl ?? null,
        createdAt: a.createdAt,
        coverPage,
        // 已有封面页或已存缩略图就不用兜底,省掉无谓的 draft 解析与线上负载。
        fallbackPhotoIds:
          coverPage || a.coverThumbnailUrl ? [] : this.fallbackCoverPhotoIds(a.draftJson),
      });
    }
    return out;
  },

  // 设计环节 phase 0:封面组选项(规则生成,零 AI)。designed=draft 里已有 cover 页
  // (幂等重入信号,ChatPanel 据此不再重复弹选择卡)。
  async listCoverSets(userId: string, albumId: string) {
    const album = await this.findOwned(userId, albumId);
    const root = album.draftJson as { tree?: { chapters?: unknown }; pages?: unknown } | null;
    const chapters = Array.isArray((root?.tree as { chapters?: unknown })?.chapters)
      ? ((root!.tree as { chapters: unknown[] }).chapters as Array<{
          photos?: Array<{ photoId: string; composition?: string | null }>;
        }>)
      : [];
    const rawPages = Array.isArray(root?.pages) ? (root!.pages as Page[]) : [];
    const designed = rawPages.some((page) => templateCategory(page.templateId) === 'cover');
    return {
      sets: buildCoverSets(albumId, chapters.map((c) => ({ photos: c.photos ?? [] }))),
      designed,
      hasPages: rawPages.length > 0,
    };
  },

  // 设计环节:用户在对话框选定封面组后调用。engine 出决策(字体/颜色/封面封尾文案),
  // 这里确定性应用:组封面/封尾页 + carrier sweep + 页序 [cover,...interior,ending]
  // 重排,落回 draft。幂等:重复调用会先剔除旧 cover/ending 再装新的。
  async applyDesign(
    userId: string,
    albumId: string,
    input: {
      language: 'zh' | 'en';
      coverTemplateId: string;
      coverPhotoId: string;
      endingTemplateId: string;
      endingPhotoId: string;
    },
  ): Promise<{ pages: Page[] }> {
    const album = await this.findOwned(userId, albumId);
    if (album.status !== 'EDITING') throw ERRORS.ALBUM_NOT_EDITABLE();
    if (templateCategory(input.coverTemplateId) !== 'cover')
      throw ERRORS.VALIDATION_FAILED(`not a cover template: ${input.coverTemplateId}`);
    if (templateCategory(input.endingTemplateId) !== 'ending')
      throw ERRORS.VALIDATION_FAILED(`not an ending template: ${input.endingTemplateId}`);

    const root = album.draftJson as { tree?: { chapters?: unknown }; pages?: unknown } | null;
    const chapters = Array.isArray((root?.tree as { chapters?: unknown })?.chapters)
      ? ((root!.tree as { chapters: unknown[] }).chapters as Array<{
          chapterContext?: string;
          photos?: Array<{ photoId: string }>;
        }>)
      : [];
    const rawPages = Array.isArray(root?.pages) ? (root!.pages as Page[]) : [];
    if (rawPages.length === 0) throw ERRORS.VALIDATION_FAILED('design requires laid-out pages');
    const treePhotoIds = new Set(
      chapters.flatMap((c) => (c.photos ?? []).map((p) => p.photoId)),
    );
    if (!treePhotoIds.has(input.coverPhotoId) || !treePhotoIds.has(input.endingPhotoId))
      throw ERRORS.VALIDATION_FAILED('cover/ending photo not in this album');

    // 幂等重入:已应用过设计则剔除旧封面/封尾,内页原样保留。
    const interiorPages = rawPages.filter(
      (page) => templateCategory(page.templateId) === 'interior',
    );

    const design = await agentClient.designV3(albumId, {
      language: input.language,
      albumTitle: (album.title ?? '').slice(0, 120),
      chapterContexts: chapters.map((c) => c.chapterContext ?? ''),
      coverSlots: slotSpecs(input.coverTemplateId),
      endingSlots: slotSpecs(input.endingTemplateId),
    });

    // 封底可能有多个图槽(mag-22 两图):hero 池按构图排序取前 4,剔除封面/封尾主图后补槽。
    const extraEndingPhotoIds = pickHeroPhotos(
      chapters.map((c) => ({ photos: (c.photos ?? []) as { photoId: string }[] })),
      4,
    ).filter((id) => id !== input.endingPhotoId && id !== input.coverPhotoId);

    const pages = assembleDesignedPages({
      interiorPages,
      set: {
        coverTemplateId: input.coverTemplateId,
        coverPhotoId: input.coverPhotoId,
        endingTemplateId: input.endingTemplateId,
        endingPhotoId: input.endingPhotoId,
      },
      coverTexts: design.coverTexts,
      endingTexts: design.endingTexts,
      fonts: design.fonts,
      colors: design.colors,
      extraEndingPhotoIds,
    });

    // 选定封面 = 故事环节收官:把现存章节全部记 done(产品口径:选完封面导出即可用)。
    // allDone 闸门保留 —— 之后追加照片引入未 done 的新章会自动重锁导出,
    // 追加排版完成(新章记 done)后自动恢复。
    const doneChapterIds = ((root?.tree as { chapters?: Array<{ chapterId?: string }> } | undefined)?.chapters ?? [])
      .map((c) => c.chapterId)
      .filter((id): id is string => typeof id === 'string');
    await albumRepo.update(db, album.id, {
      // design 决策快照随 draft 落库:设计对话的书级简报(配色主题)从这里取。
      draftJson: {
        ...(root ?? {}),
        pages,
        design: { fonts: design.fonts, colors: design.colors },
        progress: { currentChapterId: null, doneChapterIds },
      },
      pageCount: pages.length,
      // 设计完成 → 待导出(导出闸门的唯一开门钥匙)。story 阶段到不了这里(design 要求
      // 已排版页,入口在 theme 之后);幂等重设计时已是 ready 则维持不动。
      // 用户选定封面组 = 设计环节完成 ⇒ 推 stage='ready'(导出闸门解锁条件之一)。
      // 现行流程选封面发生在 story 阶段(排版完即弹卡,不经过旧 theme/cover),
      // 只要能走到这里(EDITING + 已有排版页)就该进 ready;幂等重入保持 ready。
      ...(album.stage !== 'ready' ? { stage: 'ready' as const } : {}),
    });
    // 封面选择本身进会话历史(seq 追加序):刷新回放时回执卡按真实发生位置原位重建,
    // 不再靠 stage 推断在末尾补卡(旧行为导致回执卡"跑到最下边")。user 消息带
    // designApplied 标记(回放识别),assistant 消息与前端实时回复同文案。
    await db.transaction(async (tx) => {
      await albumMessageRepo.create(tx, {
        albumId,
        userId,
        role: 'user',
        content: input.language === 'zh' ? '就用这组封面' : 'Use this cover set',
        layoutPatch: {
          designApplied: {
            coverTemplateId: input.coverTemplateId,
            coverPhotoId: input.coverPhotoId,
            endingTemplateId: input.endingTemplateId,
            endingPhotoId: input.endingPhotoId,
          },
        },
      });
      await albumMessageRepo.create(tx, {
        albumId,
        userId,
        role: 'assistant',
        content:
          input.language === 'zh'
            ? '设计好了:封面封底就位,全书字体和配色也统一刷好了。不满意随时在对话里改。'
            : 'Design done — cover & back cover are in, fonts and colors applied across the book. Ask me here to tweak anything.',
      });
    });
    return { pages };
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
