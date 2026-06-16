import { db } from '@/db/client';
import { albumRepo } from '@/db/repos/album-repo';
import { albumMessageRepo } from '@/db/repos/album-message-repo';
import { albumService } from '@/services/album/album-service';
import { agentClient } from '@/lib/agent/agent-client';
import { ERRORS } from '@/lib/api/error-codes';
import {
  AlbumDraft,
  type V2ThemeRequest,
  type V2ThemeResponse,
  type V2ChapterChatRequest,
  type V2ChapterChatResponse,
  type V2DraftEditRequest,
  type V2InspectRequest,
  type V2InspectResponse,
  type V2PhotoAnalysis,
  type ImagePos as ImagePosT,
} from '@yujee/contracts';
import type { Page } from '@yujee/contracts';

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

// #162 draft-edit: the browser tracks pages by their FLAT index (the order
// getDraftSkeleton emits: cover → toc? → chapters[].pages → ending). draft_json
// is a tree, so to slice/merge one page we walk that exact flat order and find
// which tree node the flat index lands on. Returns the page itself, the chapterId
// it belongs to (null for cover/toc/ending — used to scope history), and an
// applyTexts that produces a NEW tree with ONLY that one page's texts replaced
// (every other page identical). No whole-tree round-trip leaves Web.
type LocatedPage = {
  page: Page;
  chapterId: string | null;
  // Returns a new AlbumDraft with this page's texts replaced (slot-scoped merge
  // done by the caller); all other pages are the same object references.
  applyTexts: (texts: Record<string, string>) => AlbumDraft;
  // #165 Phase 3: returns a new AlbumDraft with this page's imagePos map replaced
  // (the caller merges {imageId:{x,y,scale}} into the page's existing overrides);
  // all other pages keep their object references (single-page write, invariant 12).
  applyImagePos: (imagePos: Record<string, ImagePosT>) => AlbumDraft;
};

function locatePage(draft: AlbumDraft, flatIndex: number): LocatedPage | null {
  let cursor = 0;
  // cover
  if (flatIndex === cursor) {
    return {
      page: draft.basePages.cover,
      chapterId: null,
      applyTexts: (texts) => ({
        ...draft,
        basePages: { ...draft.basePages, cover: { ...draft.basePages.cover, texts } },
      }),
      applyImagePos: (imagePos) => ({
        ...draft,
        basePages: { ...draft.basePages, cover: { ...draft.basePages.cover, imagePos } },
      }),
    };
  }
  cursor += 1;
  // toc (optional)
  if (draft.basePages.toc) {
    if (flatIndex === cursor) {
      const toc = draft.basePages.toc;
      return {
        page: toc,
        chapterId: null,
        applyTexts: (texts) => ({
          ...draft,
          basePages: { ...draft.basePages, toc: { ...toc, texts } },
        }),
        applyImagePos: (imagePos) => ({
          ...draft,
          basePages: { ...draft.basePages, toc: { ...toc, imagePos } },
        }),
      };
    }
    cursor += 1;
  }
  // chapter pages, in order
  for (let ci = 0; ci < draft.chapters.length; ci++) {
    const chapter = draft.chapters[ci]!;
    for (let pi = 0; pi < chapter.pages.length; pi++) {
      if (flatIndex === cursor) {
        const page = chapter.pages[pi]!;
        const replacePage = (next: Page): AlbumDraft => {
          const nextPages = chapter.pages.slice();
          nextPages[pi] = next;
          const nextChapters = draft.chapters.slice();
          nextChapters[ci] = { ...chapter, pages: nextPages };
          return { ...draft, chapters: nextChapters };
        };
        return {
          page,
          chapterId: chapter.chapterId,
          applyTexts: (texts) => replacePage({ ...page, texts }),
          applyImagePos: (imagePos) => replacePage({ ...page, imagePos }),
        };
      }
      cursor += 1;
    }
  }
  // ending
  if (flatIndex === cursor) {
    return {
      page: draft.basePages.ending,
      chapterId: null,
      applyTexts: (texts) => ({
        ...draft,
        basePages: { ...draft.basePages, ending: { ...draft.basePages.ending, texts } },
      }),
      applyImagePos: (imagePos) => ({
        ...draft,
        basePages: { ...draft.basePages, ending: { ...draft.basePages.ending, imagePos } },
      }),
    };
  }
  return null;
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
  ): Promise<{
    theme: V2ThemeRequest['currentTheme'];
    assistantReply: string;
    // Pass-through for the browser to render pickable theme options (editor.html
    // themeOpt1-3). Display-only — NOT merged into draft_json (invariant 12).
    themeOptions?: V2ThemeResponse['themeOptions'];
  }> {
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
      // Persist the conversation turn so it survives a refresh (parity with
      // chapter-chat). Theme is album-global, so these messages carry NO
      // chapterId — that keeps them out of every per-chapter history slice
      // (findRecentByAlbumChapter), while still showing in the main thread.
      if (input.userMessage) {
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
        content: result.assistantReply,
        usage: (result.usage as Record<string, unknown> | null) ?? null,
      });
      // touch updated_at (albumRepo.update always bumps it) — keeps the draft
      // alive against the 24h expiry sweep (rebuild-tech-plan §12).
      await albumRepo.update(tx, albumId, { draftJson: next });
    });

    // themeOptions: pass straight through to the browser (display-only, never
    // written into the merged draft above — invariant 12).
    return {
      theme: result.theme,
      assistantReply: result.assistantReply,
      ...(result.themeOptions ? { themeOptions: result.themeOptions } : {}),
    };
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
  ): Promise<{
    assistantReply: string;
    state: string;
    chapterId: string;
    // Pass-through for the browser to render pickable chapter-title chips
    // (editor.html chipName1-4). Display-only — NOT merged into the chapter
    // (invariant 12); the chosen title is applied via a later user action.
    nameOptions?: V2ChapterChatResponse['nameOptions'];
  }> {
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
      // nameOptions: display-only pass-through (not merged into the chapter above).
      ...(result.nameOptions ? { nameOptions: result.nameOptions } : {}),
    };
  },

  // POST /api/v2/albums/[uuid]/draft-edit — synchronous (#162). The draft-period
  // "render first version + pointed single-page edit" path, with talk/act split.
  // The browser sends the FLAT pageIndex of the page it's looking at + a free-text
  // message. We slice ONLY that page (its templateId/images/texts) + that page's
  // photo analyses from the pool (no base64, no whole tree — invariant 12), build
  // a page-scoped history, and call the agent.
  //   - kind:'act' → merge pageWrite.texts into THAT page (slot-scoped: only the
  //     returned slots change), persist draft_json, write 2 album_messages (the
  //     assistant row carries the pageWrite as its patch). Return the merged texts.
  //   - kind:'talk' → write 2 album_messages only; no draft mutation.
  // Like chapter-chat, draft-period copy edits are FREE (no credit/limit check) —
  // billing happens at init (#162 / architecture §6.7); we add no new billing here.
  async submitDraftEditV2(
    userId: string,
    albumId: string,
    input: { pageIndex: number; userMessage: string },
  ): Promise<{
    kind: 'talk' | 'act' | 'inspect';
    assistantReply: string;
    // Present iff kind==='act' via write_page_copy — the page that changed + its
    // full merged texts, so the browser can repaint that one page without a refetch.
    pageWrite?: { pageIndex: number; texts: Record<string, string> };
    // Present iff kind==='act' via adjust_image_position (#165 Phase 3) — the single
    // per-image position/scale to fold into Page.imagePos[imageId]. Already persisted
    // into draft_json server-side here; the browser mirrors it locally + repaints.
    imagePosWrite?: { pageIndex: number; imageId: string; x: number; y: number; scale: number };
    // Present iff kind==='inspect' (#165 Phase 3) — the model wants to SEE the page.
    // The browser screenshots that page → /inspect-render → diagnosis → re-issues
    // draft-edit. No draft mutation on inspect; we don't even write messages (the
    // turn isn't done — the follow-up draft-edit records it).
    inspectRequest?: { pageIndex: number };
  }> {
    const { draft } = await loadDraftAlbum(userId, albumId);

    const located = locatePage(draft, input.pageIndex);
    if (!located) throw ERRORS.VALIDATION_FAILED('page not found in draft');

    // Slice this page's photo analyses: the photoIds it actually references in its
    // images map, resolved to V2PhotoAnalysis from the pool. Pure text, no base64;
    // may be [] (e.g. a text-only cover) — the contract requires the array present.
    const analysisByPhotoId = new Map(draft.photoPool.map((p) => [p.photoId, p.analysis]));
    const photoIds = Object.values(located.page.images).filter((id): id is string => !!id);
    const photos: V2PhotoAnalysis[] = [];
    const seen = new Set<string>();
    for (const id of photoIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      const a = analysisByPhotoId.get(id);
      if (a) photos.push(a);
    }

    // Page/chapter-scoped history (≤20). Pages inside a chapter reuse that
    // chapter's thread (parity with chapter-chat); cover/toc/ending (chapterId
    // null) use the album-wide recent thread.
    const recent = located.chapterId
      ? await albumMessageRepo.findRecentByAlbumChapter(albumId, located.chapterId, HISTORY_LIMIT)
      : await albumMessageRepo.findRecentByAlbum(albumId, HISTORY_LIMIT);
    const history: V2ChatTurn[] = recent.map((m) => ({ role: m.role, content: m.content }));

    const payload: V2DraftEditRequest = {
      albumId,
      language: draft.meta.language,
      ...(draft.meta.theme && isFullTheme(draft.meta.theme) ? { theme: draft.meta.theme } : {}),
      page: {
        pageIndex: input.pageIndex,
        templateId: located.page.templateId,
        images: located.page.images,
        texts: located.page.texts,
      },
      photos,
      history,
      userMessage: input.userMessage,
      // focusedPageIndex = the page the user is on; lets "change this page" lock
      // onto the exact single page even across a 2-page spread.
      focusedPageIndex: input.pageIndex,
    };

    const result = await agentClient.draftEditV2(payload);

    // inspect (#165 Phase 3): the model wants to SEE the rendered page before it can
    // judge a crop. We DON'T mutate the draft or write messages here — the turn is
    // unfinished: the browser screenshots the page, hits /inspect-render for a
    // diagnosis, then re-issues draft-edit (which carries the diagnosis as context).
    // That follow-up turn is what records the conversation + any imagePosWrite.
    if (result.kind === 'inspect' && result.inspectRequest) {
      return {
        kind: 'inspect',
        assistantReply: result.assistantReply,
        inspectRequest: { pageIndex: result.inspectRequest.pageIndex },
      };
    }

    if (result.kind === 'act' && result.imagePosWrite) {
      // adjust_image_position (#165 Phase 3): fold ONE per-image {x,y,scale} into
      // this page's imagePos map (slot-scoped, keep every other slot), persist into
      // draft_json, and record the conversation. The browser mirrors locally.
      const w = result.imagePosWrite;
      const mergedPos: Record<string, ImagePosT> = {
        ...(located.page.imagePos ?? {}),
        [w.imageId]: { x: w.x, y: w.y, scale: w.scale },
      };
      const next = located.applyImagePos(mergedPos);

      await db.transaction(async (tx) => {
        await albumMessageRepo.create(tx, {
          albumId,
          userId,
          role: 'user',
          content: input.userMessage,
          ...(located.chapterId ? { chapterId: located.chapterId } : {}),
        });
        await albumMessageRepo.create(tx, {
          albumId,
          userId,
          role: 'assistant',
          content: result.assistantReply,
          ...(located.chapterId ? { chapterId: located.chapterId } : {}),
          // Record the applied position write in the browser-patch shape (imagePosJson),
          // so the message thread mirrors what chat-edit stores for an imagePos change.
          layoutPatch: [{ pageIndex: w.pageIndex, imagePosJson: { [w.imageId]: { x: w.x, y: w.y, scale: w.scale } } }],
          usage: (result.usage as Record<string, unknown> | null) ?? null,
        });
        await albumRepo.update(tx, albumId, { draftJson: next });
      });

      return {
        kind: 'act',
        assistantReply: result.assistantReply,
        imagePosWrite: { pageIndex: w.pageIndex, imageId: w.imageId, x: w.x, y: w.y, scale: w.scale },
      };
    }

    if (result.kind === 'act' && result.pageWrite) {
      // Hoist out of the async tx closure so the narrowing survives (TS widens
      // result.pageWrite back to optional inside the callback otherwise).
      const pageWrite = result.pageWrite;
      // Slot-scoped merge: only the returned slots change; keep every other slot
      // (and every other page) as-is. The agent echoes back the focused pageIndex.
      const mergedTexts = { ...located.page.texts, ...pageWrite.texts };
      const next = located.applyTexts(mergedTexts);

      await db.transaction(async (tx) => {
        // user + assistant rows. The assistant row carries the pageWrite as its
        // patch (parity with how chapter-chat/edit record the applied change), and
        // is tagged with the page's chapter_id so it joins that chapter's thread.
        await albumMessageRepo.create(tx, {
          albumId,
          userId,
          role: 'user',
          content: input.userMessage,
          ...(located.chapterId ? { chapterId: located.chapterId } : {}),
        });
        await albumMessageRepo.create(tx, {
          albumId,
          userId,
          role: 'assistant',
          content: result.assistantReply,
          ...(located.chapterId ? { chapterId: located.chapterId } : {}),
          // The applied write, stored in the browser-patch shape v1 chat-edit uses
          // (layout_patch column): one entry, pageIndex + the changed text slots.
          layoutPatch: [{ pageIndex: pageWrite.pageIndex, textsJson: pageWrite.texts }],
          usage: (result.usage as Record<string, unknown> | null) ?? null,
        });
        // persist the single-page merge + touch updated_at (W7c expiry, §12).
        await albumRepo.update(tx, albumId, { draftJson: next });
      });

      return {
        kind: 'act',
        assistantReply: result.assistantReply,
        pageWrite: { pageIndex: pageWrite.pageIndex, texts: mergedTexts },
      };
    }

    // talk: persist the conversation only — no draft mutation.
    await db.transaction(async (tx) => {
      await albumMessageRepo.create(tx, {
        albumId,
        userId,
        role: 'user',
        content: input.userMessage,
        ...(located.chapterId ? { chapterId: located.chapterId } : {}),
      });
      await albumMessageRepo.create(tx, {
        albumId,
        userId,
        role: 'assistant',
        content: result.assistantReply,
        ...(located.chapterId ? { chapterId: located.chapterId } : {}),
        usage: (result.usage as Record<string, unknown> | null) ?? null,
      });
    });

    return { kind: 'talk', assistantReply: result.assistantReply };
  },

  // POST /api/v2/albums/[uuid]/inspect-render — synchronous (#165 Phase 3). After
  // draft-edit returns kind:'inspect', the browser renders+screenshots that one
  // page and posts it here. We slice ONLY that page + its photo analyses (exactly
  // like submitDraftEditV2 — invariant 12, no whole tree), forward the screenshot
  // to the agent's ONE vision call (/v2/album/inspect-page), and return its
  // diagnosis + reply. The screenshot is the only new base64 channel; it goes
  // straight into the upstream vision request and is NEVER persisted, logged, or
  // written to draft_json (invariant 1/2, same posture as init vision). This method
  // does NOT mutate draft_json or write album_messages — the follow-up draft-edit
  // (which the browser issues with the diagnosis as context) records the turn.
  async submitInspectRenderV2(
    userId: string,
    albumId: string,
    input: { pageIndex: number; userMessage: string; screenshot: string },
  ): Promise<{
    diagnosis: V2InspectResponse['diagnosis'];
    assistantReply: string;
  }> {
    const { draft } = await loadDraftAlbum(userId, albumId);

    const located = locatePage(draft, input.pageIndex);
    if (!located) throw ERRORS.VALIDATION_FAILED('page not found in draft');

    // Same single-page photo-analysis slice as draft-edit: only the photoIds this
    // page references, resolved to V2PhotoAnalysis from the pool. Pure text, no
    // base64 beyond the screenshot itself.
    const analysisByPhotoId = new Map(draft.photoPool.map((p) => [p.photoId, p.analysis]));
    const photoIds = Object.values(located.page.images).filter((id): id is string => !!id);
    const photos: V2PhotoAnalysis[] = [];
    const seen = new Set<string>();
    for (const id of photoIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      const a = analysisByPhotoId.get(id);
      if (a) photos.push(a);
    }

    const payload: V2InspectRequest = {
      albumId,
      language: draft.meta.language,
      page: {
        pageIndex: input.pageIndex,
        templateId: located.page.templateId,
        images: located.page.images,
        texts: located.page.texts,
      },
      photos,
      screenshot: input.screenshot,
      userMessage: input.userMessage,
    };

    const result = await agentClient.inspectRenderV2(payload);
    return { diagnosis: result.diagnosis, assistantReply: result.assistantReply };
  },
};

// V2ThemeRequest.currentTheme / V2ChapterChatRequest.theme are a full V2Theme,
// but draft.meta.theme is V2Theme.partial() (init may only have a promptHint).
// Only forward it as a constraint once every required field is present.
function isFullTheme(t: Partial<AlbumDraft['meta']['theme']>): t is NonNullable<V2ThemeRequest['currentTheme']> {
  return Boolean(t && t.subject && t.tone && t.style);
}
