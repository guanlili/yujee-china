import { db } from '@/db/client';
import { albumService } from '@/services/album/album-service';
import { albumRepo } from '@/db/repos/album-repo';
import { albumPageRepo } from '@/db/repos/album-page-repo';
import { albumMessageRepo } from '@/db/repos/album-message-repo';
import { agentClient, type LayoutPatchEntry } from '@/lib/agent/agent-client';
import { AlbumLayoutPlan, type AlbumLayoutPlanT, type PageT } from '@/lib/agent/layout-schema';
import { ERRORS } from '@/lib/api/error-codes';
import { logger } from '@/lib/log/logger';

const HISTORY_LIMIT = 20;

// Best-effort per-album lock so two concurrent chats can't race patches onto the
// same album (docs/web/api.md §3.5a CHAT_BUSY). In-process only — sufficient for
// the 1000-user, single-region target; not a cross-instance guarantee.
const inFlight = new Set<string>();

// Mirror the agent's apply semantics (apps/agent/src/services/chat_edit_v2.py):
// templateId change → full replace; otherwise images replace wholesale, texts merge.
function applyPatch(layout: AlbumLayoutPlanT, patch: LayoutPatchEntry[]): AlbumLayoutPlanT {
  const pages: PageT[] = layout.pages.map((p) => ({
    ...p,
    images: { ...p.images },
    texts: { ...p.texts },
    // #165 D1: preserve per-slot position overrides through the rebuild — without
    // this, every chat-edit silently strips an existing imagePos off untouched pages.
    ...(p.imagePos !== undefined ? { imagePos: { ...p.imagePos } } : {}),
  }));
  const indexOf = new Map(pages.map((p, i) => [p.pageIndex, i]));

  for (const entry of patch) {
    const i = indexOf.get(entry.pageIndex);
    if (i === undefined) continue;
    const original = pages[i]!;
    if (entry.templateId && entry.templateId !== original.templateId) {
      // Template swap → full slot reset; position overrides start fresh (#165).
      pages[i] = {
        pageIndex: entry.pageIndex,
        templateId: entry.templateId,
        images: { ...(entry.images ?? {}) },
        texts: { ...(entry.texts ?? {}) },
        ...(entry.imagePos !== undefined ? { imagePos: { ...entry.imagePos } } : {}),
      };
    } else {
      // #165 D1: an imagePos patch (Phase-3 adjust) merges into the slot's
      // overrides; absent patch keeps the page's existing overrides untouched.
      const mergedPos =
        entry.imagePos !== undefined
          ? { ...(original.imagePos ?? {}), ...entry.imagePos }
          : original.imagePos;
      pages[i] = {
        pageIndex: entry.pageIndex,
        templateId: original.templateId,
        images: entry.images !== undefined ? { ...entry.images } : original.images,
        texts: entry.texts !== undefined ? { ...original.texts, ...entry.texts } : original.texts,
        ...(mergedPos !== undefined ? { imagePos: mergedPos } : {}),
      };
    }
  }

  return { ...layout, pages };
}

// Agent emits images/texts (Agent↔Web boundary). The browser-facing API uses
// imagesJson/textsJson (docs/web/api.md §3.5a), same as GET detail / PATCH pages.
function toBrowserPatch(patch: LayoutPatchEntry[]) {
  return patch.map((e) => ({
    pageIndex: e.pageIndex,
    ...(e.templateId !== undefined ? { templateId: e.templateId } : {}),
    ...(e.images !== undefined ? { imagesJson: e.images } : {}),
    ...(e.texts !== undefined ? { textsJson: e.texts } : {}),
    // #165 D1: carry the per-slot override into the browser patch (imagePosJson),
    // matching GET detail / PATCH pages — else the browser preview can't reflect it.
    ...(e.imagePos !== undefined ? { imagePosJson: e.imagePos } : {}),
  }));
}

export const chatService = {
  async listMessages(userId: string, albumId: string, limit = 50) {
    await albumService.findOwned(userId, albumId);
    const rows = await albumMessageRepo.findRecentByAlbum(albumId, limit);
    return {
      messages: rows.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        layoutPatch: m.layoutPatch ?? null,
        createdAt: m.createdAt,
      })),
    };
  },

  async edit(
    userId: string,
    albumId: string,
    message: string,
    language: 'zh' | 'en',
    focusedPageIndex?: number,
  ) {
    const album = await albumService.findOwned(userId, albumId);
    if (album.status !== 'EDITING') throw ERRORS.ALBUM_NOT_EDITABLE();

    const parsedCurrent = AlbumLayoutPlan.safeParse(album.layoutJson);
    if (!parsedCurrent.success) throw ERRORS.AGENT_INVALID_OUTPUT();

    if (inFlight.has(albumId)) throw ERRORS.CHAT_BUSY();
    inFlight.add(albumId);
    try {
      const recent = await albumMessageRepo.findRecentByAlbum(albumId, HISTORY_LIMIT);
      const history = recent.map((m) => ({ role: m.role, content: m.content }));

      logger.info({ userId, albumId, action: 'chat.edit' });
      // v2 cutover (D-V1Kill): the editor — for BOTH new v2 albums and legacy v1
      // albums — goes through /v2/album/edit, the superset of the deleted
      // /v1/chat-edit (+ pickTemplate Tool). Both kinds store a flat
      // AlbumLayoutPlan in layout_json, which is exactly editV2's `currentLayout`,
      // so this is one editing path for all works (rebuild-architecture §7).
      const result = await agentClient.editV2({
        albumId,
        currentLayout: parsedCurrent.data,
        history,
        userMessage: message,
        language,
        // Only forward a focus that actually exists in the current layout — a stale
        // index (page removed/reordered) is dropped rather than misdirecting the AI.
        ...(focusedPageIndex !== undefined &&
        parsedCurrent.data.pages.some((p) => p.pageIndex === focusedPageIndex)
          ? { focusedPageIndex }
          : {}),
      });

      // Invariant 9: apply + re-validate before persisting the layout.
      const next = AlbumLayoutPlan.safeParse(applyPatch(parsedCurrent.data, result.layoutPatch));
      if (!next.success) throw ERRORS.AGENT_CHAT_FAILED();
      const layout = next.data;

      const browserPatch = toBrowserPatch(result.layoutPatch);

      const messageId = await db.transaction(async (tx) => {
        await albumMessageRepo.create(tx, { albumId, userId, role: 'user', content: message });

        for (const entry of result.layoutPatch) {
          const page = layout.pages.find((p) => p.pageIndex === entry.pageIndex);
          if (!page) continue;
          await albumPageRepo.updateOne(tx, albumId, entry.pageIndex, {
            imagesJson: page.images,
            textsJson: page.texts,
            // #165 D1: persist the merged per-slot overrides too (page.imagePos may
            // be undefined → column stays null), so a reload keeps the position.
            ...(page.imagePos !== undefined ? { imagePosJson: page.imagePos } : {}),
          });
        }

        await albumRepo.update(tx, albumId, { layoutJson: layout, pageCount: layout.pages.length });

        const assistant = await albumMessageRepo.create(tx, {
          albumId,
          userId,
          role: 'assistant',
          content: result.assistantReply,
          layoutPatch: browserPatch,
          usage: (result.usage as Record<string, unknown> | null) ?? null,
        });
        return assistant.id;
      });

      return {
        assistantReply: result.assistantReply,
        layoutPatch: browserPatch,
        messageId,
      };
    } finally {
      inFlight.delete(albumId);
    }
  },
};

// Test-only: the two pure patch helpers, exported so the #165 D1 regression
// (imagePos dropped through applyPatch/toBrowserPatch) can be asserted directly.
export const __test__ = { applyPatch, toBrowserPatch };
