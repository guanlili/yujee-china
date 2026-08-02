// Standalone service for photo originals (照片真相迁 R2 Phase 0). Mirrors
// share-service.ts's small-standalone-singleton style rather than growing
// album-service.ts (already ~1700 lines) any further.
//
// album_photos is the album-level ledger of which originals the browser has
// actually PUT to R2 (photo-originals/{albumId}/{photoId}.jpg) vs. which are
// still missing. Only signUpload/confirm/getUrls touch it; no other service
// writes this table.

import { db } from '@/db/client';
import { albumRepo } from '@/db/repos/album-repo';
import { albumPhotoRepo, type AlbumPhotoUpsert } from '@/db/repos/album-photo-repo';
import { r2 } from '@/lib/r2/r2-client';
import { ERRORS } from '@/lib/api/error-codes';
import {
  PHOTO_ORIGINAL_CONTENT_TYPE,
  photoOriginalKey,
  PhotoOriginalEntriesBodySchema,
  PhotoOriginalConfirmBodySchema,
  PhotoOriginalUrlsBodySchema,
  type PhotoOriginalEntry,
} from './photo-original-util';

function validationMessage(error: { issues: { message: string }[] }): string {
  return error.issues.map((i) => i.message).join('; ');
}

export const photoOriginalService = {
  // Presign one PUT per entry. No DB write here — album_photos only gets a row
  // once the browser reports back a real PUT (or an explicit miss) via confirm().
  async signUpload(
    userId: string,
    albumId: string,
    entries: PhotoOriginalEntry[],
  ): Promise<{ photoId: string; putUrl: string; r2Key: string }[]> {
    const album = await albumRepo.findById(albumId);
    if (!album) throw ERRORS.ALBUM_NOT_FOUND();
    if (album.userId !== userId) throw ERRORS.ALBUM_NOT_OWNED();

    // Re-validate inside the service — the route's parseBody already ran this
    // schema, but the service must not trust callers other than the route.
    const parsed = PhotoOriginalEntriesBodySchema.safeParse({ entries });
    if (!parsed.success) throw ERRORS.VALIDATION_FAILED(validationMessage(parsed.error));

    const out: { photoId: string; putUrl: string; r2Key: string }[] = [];
    for (const e of parsed.data.entries) {
      const r2Key = photoOriginalKey(albumId, e.photoId);
      const putUrl = await r2.signPutUrl(r2Key, PHOTO_ORIGINAL_CONTENT_TYPE, 300);
      out.push({ photoId: e.photoId, putUrl, r2Key });
    }
    return out;
  },

  // Browser reports back which of the presigned PUTs actually succeeded
  // (`entries`, with real width/height/bytes) and which it gave up on
  // (`missing`). Row-locks the album so two concurrent confirms can't race;
  // reads current album_photos state before writing so an already-uploaded
  // photoId reappearing in `missing` (e.g. a stale/duplicate client report)
  // is filtered out before the upsert — belt-and-suspenders on top of
  // upsertMany's own CASE guard against downgrading 'uploaded' rows.
  async confirm(
    userId: string,
    albumId: string,
    input: { entries?: PhotoOriginalEntry[]; missing?: string[] },
  ): Promise<{ uploaded: number; missing: number }> {
    return db.transaction(async (tx) => {
      const album = await albumRepo.findByIdForUpdate(tx, albumId);
      if (!album) throw ERRORS.ALBUM_NOT_FOUND();
      if (album.userId !== userId) throw ERRORS.ALBUM_NOT_OWNED();

      const parsed = PhotoOriginalConfirmBodySchema.safeParse(input);
      if (!parsed.success) throw ERRORS.VALIDATION_FAILED(validationMessage(parsed.error));

      // Read-committed, outside `tx`, but the album row lock above already
      // serializes concurrent confirms: a second confirm can't get past
      // findByIdForUpdate until the first one commits, so this plain read
      // always reflects the latest committed state for this album.
      const existing = await albumPhotoRepo.findByAlbum(albumId);
      const statusById = new Map(existing.map((r) => [r.photoId, r.status]));

      const entryRows: AlbumPhotoUpsert[] = (parsed.data.entries ?? []).map((e) => ({
        photoId: e.photoId,
        status: 'uploaded',
        // Always pass full metadata through — an 'uploaded' upsert with
        // width/height/bytes omitted would null out existing metadata.
        width: e.width,
        height: e.height,
        bytes: e.bytes,
      }));
      for (const row of entryRows) statusById.set(row.photoId, 'uploaded');

      const missingRows: AlbumPhotoUpsert[] = (parsed.data.missing ?? [])
        .filter((photoId) => statusById.get(photoId) !== 'uploaded')
        .map((photoId) => ({ photoId, status: 'missing' }));
      for (const row of missingRows) statusById.set(row.photoId, 'missing');

      await albumPhotoRepo.upsertMany(tx, albumId, [...entryRows, ...missingRows]);

      let uploaded = 0;
      let missing = 0;
      for (const status of statusById.values()) {
        if (status === 'uploaded') uploaded++;
        else missing++;
      }
      return { uploaded, missing };
    });
  },

  // Only 'uploaded' rows within the requested photoIds get a signed GET.
  // Missing/never-registered photoIds are silently absent from the result —
  // callers treat a missing key as "no original available".
  async getUrls(
    userId: string,
    albumId: string,
    photoIds: string[],
  ): Promise<Record<string, string>> {
    const album = await albumRepo.findById(albumId);
    if (!album) throw ERRORS.ALBUM_NOT_FOUND();
    if (album.userId !== userId) throw ERRORS.ALBUM_NOT_OWNED();

    const parsed = PhotoOriginalUrlsBodySchema.safeParse({ photoIds });
    if (!parsed.success) throw ERRORS.VALIDATION_FAILED(validationMessage(parsed.error));

    const requested = new Set(parsed.data.photoIds);
    const rows = await albumPhotoRepo.findByAlbum(albumId);
    const uploaded = rows.filter((r) => r.status === 'uploaded' && requested.has(r.photoId));

    const out: Record<string, string> = {};
    for (const row of uploaded) {
      out[row.photoId] = await r2.signGetUrl(photoOriginalKey(albumId, row.photoId), 300);
    }
    return out;
  },
};
