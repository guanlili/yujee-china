type PagePhotoRefRegistration = {
  albumId: string;
  chapterId: string;
  refs: Record<string, string> | Array<{ photoId: string; ref200px: string }>;
};

// Process-local request-window storage for 200px page-photo refs. Callers that
// register refs must call `clear(albumId, chapterId)` when that transient window
// closes; #265 can add TTL/cap management when the full edit-chat flow owns the
// lifecycle.
const refsByChapter = new Map<string, Map<string, string>>();

function keyFor(albumId: string, chapterId: string): string {
  return `${albumId}\u0000${chapterId}`;
}

function toRefMap(refs: PagePhotoRefRegistration['refs']): Map<string, string> {
  if (Array.isArray(refs)) {
    return new Map(refs.map((item) => [item.photoId, item.ref200px]));
  }
  return new Map(Object.entries(refs));
}

export const transientPagePhotoRefs = {
  register(input: PagePhotoRefRegistration): void {
    const refs = toRefMap(input.refs);
    const key = keyFor(input.albumId, input.chapterId);
    if (refs.size === 0) refsByChapter.delete(key);
    else refsByChapter.set(key, refs);
  },

  get(albumId: string, chapterId: string): ReadonlyMap<string, string> {
    return new Map(refsByChapter.get(keyFor(albumId, chapterId)));
  },

  clear(albumId: string, chapterId: string): void {
    refsByChapter.delete(keyFor(albumId, chapterId));
  },

  resetForTest(): void {
    refsByChapter.clear();
  },
};
