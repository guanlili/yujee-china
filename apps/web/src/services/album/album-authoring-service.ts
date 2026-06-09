import { db } from '@/db/client';
import { albumRepo } from '@/db/repos/album-repo';
import { albumMessageRepo } from '@/db/repos/album-message-repo';
import { albumService } from '@/services/album/album-service';
import { agentClient } from '@/lib/agent/agent-client';
import { ERRORS } from '@/lib/api/error-codes';
import {
  AlbumDraft,
  type V2ThemeRequest,
  type V2ChapterChatRequest,
} from '@yujee/contracts';

// The chat-turn shape isn't exported from the contract (it's a local const there);
// derive it from the history array element so we stay in sync without touching v2.ts.
type V2ChatTurn = V2ChapterChatRequest['history'][number];

// W9 (#139): the synchronous authoring loop. theme + chapter-chat are the two
// interactive steps between init (Stage 1+3) and finalize (Stage 5). Web holds
// the authoring tree (draft_json, invariant 12 — it never round-trips through the
// browser); each turn slices the tree, calls the agent, and merges the reply back.
// rebuild-architecture.md §3 (Web 持树 / 作用域裁剪), rebuild-tech-plan.md §1.2/§1.3.

// HISTORY_LIMIT bounds the chapter-chat history slice we resend each turn. The
// contract caps history at 20 turns; we resend the last 20 messages OF THIS
// CHAPTER (chapter-chat is scoped per chapter, architecture §3).
const HISTORY_LIMIT = 20;

// Load the album, enforce ownership, and require it be in the draft phase
// (EDITING with a valid draft_json and not yet finalized). theme/chapter-chat are
// only meaningful before finalize; ALBUM_NOT_EDITABLE mirrors submitFinalizeV2's
// guard (a finalized album has layout_json, an un-init'd one has no draft).
async function loadDraftAlbum(userId: string, albumId: string): Promise<{
  draft: AlbumDraft;
}> {
  const album = await albumService.findOwned(userId, albumId);
  if (album.status !== 'EDITING' || album.layoutJson) throw ERRORS.ALBUM_NOT_EDITABLE();
  const parsed = AlbumDraft.safeParse(album.draftJson);
  if (!parsed.success) throw ERRORS.ALBUM_NOT_EDITABLE();
  return { draft: parsed.data };
}

export const albumAuthoringService = {
  // POST /api/v2/albums/[uuid]/theme — synchronous (Stage 2). Build a clusters
  // overview from the tree (each chapter's label/place/timeRange + up to 8 photo
  // descriptions, NO base64; architecture §3), call the agent, and merge the
  // returned theme into draft_json.meta.theme (+ basePages.cover if a cover draft
  // came back). The whole read-modify-write is one tx (invariant 8 spirit).
  async submitThemeV2(
    userId: string,
    albumId: string,
    input: { userMessage?: string },
  ): Promise<{ theme: V2ThemeRequest['currentTheme']; assistantReply: string }> {
    const { draft } = await loadDraftAlbum(userId, albumId);

    // descByPhotoId: map used photo ids → their analysis description, so each
    // chapter overview can cite a few concrete photo descs without base64.
    const descByPhotoId = new Map(draft.photoPool.map((p) => [p.photoId, p.analysis.description]));
    const clustersOverview: V2ThemeRequest['clustersOverview'] = draft.chapters.map((ch) => ({
      chapterId: ch.chapterId,
      label: ch.cluster.label,
      place: ch.cluster.place ?? null,
      timeRange: ch.cluster.timeRange ?? null,
      photoDescs: ch.photoIds
        .map((id) => descByPhotoId.get(id))
        .filter((d): d is string => d !== undefined)
        .slice(0, 8),
    }));
    if (clustersOverview.length === 0) throw ERRORS.ALBUM_NOT_EDITABLE();

    const result = await agentClient.themeV2({
      albumId,
      language: draft.meta.language,
      clustersOverview,
      ...(draft.meta.theme && isFullTheme(draft.meta.theme)
        ? { currentTheme: draft.meta.theme }
        : {}),
      ...(input.userMessage ? { userMessage: input.userMessage } : {}),
    });

    // Merge: theme fully replaces meta.theme (the agent returns a complete
    // V2Theme); if a cover draft came back, patch basePages.cover's templateId/
    // texts/heroPhotoId in place (keep the existing images map untouched).
    const next: AlbumDraft = {
      ...draft,
      meta: { ...draft.meta, theme: result.theme },
      ...(result.cover
        ? {
            basePages: {
              ...draft.basePages,
              cover: {
                ...draft.basePages.cover,
                templateId: result.cover.templateId,
                texts: result.cover.texts,
                ...(result.cover.heroPhotoId
                  ? { images: { ...draft.basePages.cover.images, hero: result.cover.heroPhotoId } }
                  : {}),
              },
            },
          }
        : {}),
    };

    await db.transaction(async (tx) => {
      // touch updated_at (albumRepo.update always bumps it) — keeps the draft
      // alive against the 24h expiry sweep (rebuild-tech-plan §12).
      await albumRepo.update(tx, albumId, { draftJson: next });
    });

    return { theme: result.theme, assistantReply: result.assistantReply };
  },

  // POST /api/v2/albums/[uuid]/chapter-chat — synchronous (Stage 4). Slice ONLY
  // the named chapter (its cluster, the analysis of its used photos, current
  // brief + skeleton pages, and this chapter's history; architecture §3 — never
  // the whole tree), call the agent, then merge the reply back into THAT chapter
  // (pages[].texts / brief / state / askCount++). Writes two album_messages rows
  // (user + assistant, both carrying chapter_id) and touches updated_at — all in
  // one tx (invariant 8). W7c's draft-expiry judgement depends on updated_at (§12).
  async submitChapterChatV2(
    userId: string,
    albumId: string,
    input: { chapterId: string; userMessage: string },
  ): Promise<{ assistantReply: string; state: string; chapterId: string }> {
    const { draft } = await loadDraftAlbum(userId, albumId);

    const chapterIdx = draft.chapters.findIndex((c) => c.chapterId === input.chapterId);
    if (chapterIdx === -1) throw ERRORS.VALIDATION_FAILED('chapter not found in draft');
    const chapter = draft.chapters[chapterIdx]!;

    // Slice this chapter's photo analyses (used photos only — duplicates folded
    // out, architecture §3) from the pool. analysisByPhotoId resolves photoIds →
    // V2PhotoAnalysis; pure text, no base64.
    const analysisByPhotoId = new Map(draft.photoPool.map((p) => [p.photoId, p.analysis]));
    const photos = chapter.photoIds
      .map((id) => analysisByPhotoId.get(id))
      .filter((a): a is NonNullable<typeof a> => a !== undefined);

    // This chapter's history only (chapter_id scoped). The contract caps at 20.
    const recent = await albumMessageRepo.findRecentByAlbumChapter(
      albumId,
      input.chapterId,
      HISTORY_LIMIT,
    );
    const history: V2ChatTurn[] = recent.map((m) => ({ role: m.role, content: m.content }));

    const payload: V2ChapterChatRequest = {
      albumId,
      language: draft.meta.language,
      ...(draft.meta.theme && isFullTheme(draft.meta.theme) ? { theme: draft.meta.theme } : {}),
      chapter: {
        chapterId: chapter.chapterId,
        state: chapter.state,
        cluster: chapter.cluster,
        photos,
        ...(chapter.brief ? { brief: chapter.brief } : {}),
        pages: chapter.pages,
      },
      history,
      userMessage: input.userMessage,
    };

    const result = await agentClient.chapterChatV2(payload);

    // Merge into THIS chapter only (other chapters untouched):
    //  - pages[].texts: apply each returned pagesTexts entry by pageIndex.
    //  - brief: replace if the agent distilled one.
    //  - state: the agent owns the state transition (§5.1); we adopt it.
    //  - askCount++: every turn counts (askCount>=2 auto-advances, §5.1).
    const pagesTextsByIndex = new Map(
      (result.pagesTexts ?? []).map((pt) => [pt.pageIndex, pt.texts]),
    );
    const mergedChapter = {
      ...chapter,
      pages: chapter.pages.map((pg) =>
        pagesTextsByIndex.has(pg.pageIndex)
          ? { ...pg, texts: pagesTextsByIndex.get(pg.pageIndex)! }
          : pg,
      ),
      ...(result.chapterBrief ? { brief: result.chapterBrief } : {}),
      state: result.state,
      askCount: chapter.askCount + 1,
    };
    const nextChapters = draft.chapters.slice();
    nextChapters[chapterIdx] = mergedChapter;
    const next: AlbumDraft = { ...draft, chapters: nextChapters };

    await db.transaction(async (tx) => {
      // Two messages per turn (user + assistant), both tagged with chapter_id so
      // the per-chapter history slice above stays correct (architecture §3).
      await albumMessageRepo.create(tx, {
        albumId,
        userId,
        role: 'user',
        content: input.userMessage,
        chapterId: input.chapterId,
      });
      await albumMessageRepo.create(tx, {
        albumId,
        userId,
        role: 'assistant',
        content: result.assistantReply,
        chapterId: input.chapterId,
        usage: (result.usage as Record<string, unknown> | null) ?? null,
      });
      // touch updated_at + persist the merged tree (W7c expiry depends on it, §12).
      await albumRepo.update(tx, albumId, { draftJson: next });
    });

    return {
      assistantReply: result.assistantReply,
      state: result.state,
      chapterId: input.chapterId,
    };
  },
};

// V2ThemeRequest.currentTheme / V2ChapterChatRequest.theme are a full V2Theme,
// but draft.meta.theme is V2Theme.partial() (init may only have a promptHint).
// Only forward it as a constraint once every required field is present.
function isFullTheme(t: Partial<AlbumDraft['meta']['theme']>): t is NonNullable<V2ThemeRequest['currentTheme']> {
  return Boolean(t && t.subject && t.tone && t.style);
}
