export interface EditorPage {
  pageIndex: number;
  templateId: string;
  imagesJson: Record<string, string>;
  textsJson: Record<string, string>;
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
  const next = pages.map((p) => ({ ...p, imagesJson: { ...p.imagesJson }, textsJson: { ...p.textsJson } }));
  for (const entry of patch) {
    const page = next.find((p) => p.pageIndex === entry.pageIndex);
    if (!page) continue;
    if (entry.templateId && entry.templateId !== page.templateId) {
      page.templateId = entry.templateId;
      page.imagesJson = { ...(entry.imagesJson ?? {}) };
      page.textsJson = { ...(entry.textsJson ?? {}) };
    } else {
      if (entry.imagesJson !== undefined) page.imagesJson = { ...entry.imagesJson };
      if (entry.textsJson !== undefined) page.textsJson = { ...page.textsJson, ...entry.textsJson };
    }
  }
  return next;
}
