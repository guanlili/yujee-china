// Per-image render override (#165), keyed by the same slotId as imagesJson.
// Absent slot => renderer defaults to objectPosition 50% 50%, no zoom.
export interface ImagePos {
  x: number;
  y: number;
  scale: number;
}

export interface EditorPage {
  pageIndex: number;
  templateId: string;
  imagesJson: Record<string, string>;
  textsJson: Record<string, string>;
  // Optional per-slot position/scale overrides. Absent => render default 50/50/1.
  imagePosJson?: Record<string, ImagePos>;
}

export interface AlbumInfo {
  id: string;
  title: string;
  status: string;
  prompt: string;
  layoutJson: unknown;
  photoCount: number;
  pageCount: number;
  pdfUrl: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface AlbumDetail {
  album: AlbumInfo;
  pages: EditorPage[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  layoutPatch: unknown;
  createdAt: string;
}

// Browser-facing patch shape (docs/web/api.md §3.5a) — imagesJson/textsJson,
// matching GET detail and PATCH pages. The Web tier translates the agent's
// images/texts into this before it reaches the browser.
export interface LayoutPatchEntry {
  pageIndex: number;
  templateId?: string;
  imagesJson?: Record<string, string>;
  textsJson?: Record<string, string>;
  imagePosJson?: Record<string, ImagePos>;
}

// photoIds the album knows about — from the layout's analysed photo set, used to
// populate the image-slot reassignment dropdown.
export function extractPhotoIds(layoutJson: unknown): string[] {
  const photos = (layoutJson as { photos?: { photoId?: string }[] } | null)?.photos;
  if (!Array.isArray(photos)) return [];
  return photos.map((p) => p.photoId).filter((x): x is string => typeof x === 'string' && x.length > 0);
}

// Mirror chat-service applyPatch on the client so the preview updates without a
// full reload (docs/web/api.md §3.5a).
export function applyPatchToPages(pages: EditorPage[], patch: LayoutPatchEntry[]): EditorPage[] {
  const next = pages.map((p) => ({
    ...p,
    imagesJson: { ...p.imagesJson },
    textsJson: { ...p.textsJson },
    imagePosJson: { ...(p.imagePosJson ?? {}) },
  }));
  for (const entry of patch) {
    const page = next.find((p) => p.pageIndex === entry.pageIndex);
    if (!page) continue;
    if (entry.templateId && entry.templateId !== page.templateId) {
      // Template swap => full slot reset; position overrides start fresh (#165).
      page.templateId = entry.templateId;
      page.imagesJson = { ...(entry.imagesJson ?? {}) };
      page.textsJson = { ...(entry.textsJson ?? {}) };
      page.imagePosJson = { ...(entry.imagePosJson ?? {}) };
    } else {
      if (entry.imagesJson !== undefined) {
        // Photo-swap reset (#165 architect decision): a slot whose photoId
        // changed gets its position override cleared (new subject => 50/50/1).
        const prevImages = page.imagesJson;
        const nextPos = { ...page.imagePosJson };
        for (const slot of Object.keys(nextPos)) {
          if (prevImages[slot] !== entry.imagesJson[slot]) delete nextPos[slot];
        }
        page.imagesJson = { ...entry.imagesJson };
        page.imagePosJson = nextPos;
      }
      if (entry.textsJson !== undefined) page.textsJson = { ...page.textsJson, ...entry.textsJson };
      // An explicit imagePos patch (Phase 3 adjust) overrides the reset above.
      if (entry.imagePosJson !== undefined) {
        page.imagePosJson = { ...page.imagePosJson, ...entry.imagePosJson };
      }
    }
  }
  return next;
}
