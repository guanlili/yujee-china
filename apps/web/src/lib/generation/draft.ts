'use client';

// A generation draft is the lightweight recipe needed to (re)submit a memoir:
// prompt, language, and the photoIds whose originals already live in IndexedDB
// (invariant 1 — base64 is never persisted, it's rebuilt from the originals).
//
// It exists so an in-flight create request survives a detour to /pricing when
// the user is short on credits (§6.5.2): we stash the draft, send them to top
// up, and on return rebuild the exact same submission. Stored in localStorage so
// it survives a full reload / external checkout redirect.

export type GenerationDraft = {
  prompt: string;
  language: 'zh' | 'en';
  photoIds: string[];
};

const KEY = 'yujee:gen-draft';

export const generationDraft = {
  save(draft: GenerationDraft): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(draft));
    } catch {
      // Private mode / quota — resume just won't be offered; not fatal.
    }
  },

  load(): GenerationDraft | null {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const d = JSON.parse(raw) as GenerationDraft;
      if (!d || typeof d.prompt !== 'string' || !Array.isArray(d.photoIds) || d.photoIds.length === 0) {
        return null;
      }
      return d;
    } catch {
      return null;
    }
  },

  clear(): void {
    try {
      localStorage.removeItem(KEY);
    } catch {
      // ignore
    }
  },
};

// Per-album recipe (§6.5.3 retry). Saved when a generation is submitted so a
// later FAILED → retry on /album/[uuid] or /my-albums knows which originals to
// resend (the prompt is reused server-side from the stored album, so only
// language + photoIds are needed). Keyed per album so multiple in-flight albums
// don't collide. Originals themselves stay in photoStore (IndexedDB); this is
// just the id list. Best-effort — if it's missing, the UI offers a fresh start.
export type AlbumRecipe = {
  language: 'zh' | 'en';
  photoIds: string[];
};

const recipeKey = (albumId: string) => `yujee:album-recipe:${albumId}`;

export const albumRecipe = {
  save(albumId: string, recipe: AlbumRecipe): void {
    try {
      localStorage.setItem(recipeKey(albumId), JSON.stringify(recipe));
    } catch {
      // ignore
    }
  },

  load(albumId: string): AlbumRecipe | null {
    try {
      const raw = localStorage.getItem(recipeKey(albumId));
      if (!raw) return null;
      const r = JSON.parse(raw) as AlbumRecipe;
      if (!r || !Array.isArray(r.photoIds) || r.photoIds.length === 0) return null;
      return r;
    } catch {
      return null;
    }
  },
};
