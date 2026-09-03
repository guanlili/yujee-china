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
import { collaborationService, resolveRole } from '@/services/collaboration/collaboration-service';
import { COLLAB_ERRORS } from '@/services/collaboration/collaboration-errors';
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
  // 上传(collab rework §3.3):owner/editor 都是 Creator 都可上传;key 归 album
  // 命名空间(photo-originals/{albumId}/{photoId}.jpg),与执行者身份无关。
  // 防覆盖闸:已 uploaded 的 photoId 不再签发(签名 PUT 恒覆盖写,重签=静默覆盖
  // 他人上传的原始字节)—— 对多标签页/旧客户端的 best-effort 服务端防线。
  async signUpload(
    userId: string,
    albumId: string,
    entries: PhotoOriginalEntry[],
  ): Promise<{ photoId: string; putUrl: string; r2Key: string }[]> {
    const album = (await collaborationService.requireAccess(userId, albumId)).album;

    // Re-validate inside the service — the route's parseBody already ran this
    // schema, but the service must not trust callers other than the route.
    const parsed = PhotoOriginalEntriesBodySchema.safeParse({ entries });
    if (!parsed.success) throw ERRORS.VALIDATION_FAILED(validationMessage(parsed.error));

    const uploadedIds = new Set(
      (await albumPhotoRepo.findByAlbum(albumId))
        .filter((r) => r.status === 'uploaded')
        .map((r) => r.photoId),
    );

    const out: { photoId: string; putUrl: string; r2Key: string }[] = [];
    for (const e of parsed.data.entries) {
      if (uploadedIds.has(e.photoId)) continue;
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
  // confirm(collab rework §3.3):Creator 均可;uploaded 行落 uploadedBy 署名
  // (最后确认 PUT 成功的执行者)。
  async confirm(
    userId: string,
    albumId: string,
    input: { entries?: PhotoOriginalEntry[]; missing?: string[] },
  ): Promise<{ uploaded: number; missing: number }> {
    return db.transaction(async (tx) => {
      const album = await albumRepo.findByIdForUpdate(tx, albumId);
      if (!album) throw ERRORS.ALBUM_NOT_FOUND();
      const role = await resolveRole(album, userId, tx);
      if (!role) throw COLLAB_ERRORS.ALBUM_ACCESS_DENIED();

      const parsed = PhotoOriginalConfirmBodySchema.safeParse(input);
      if (!parsed.success) throw ERRORS.VALIDATION_FAILED(validationMessage(parsed.error));

      // Read inside `tx` — not just for confirm-vs-confirm ordering (which the
      // album row lock alone would provide), but because album-service.delete
      // now also takes that same row lock (findByIdForUpdate) before running
      // deleteByAlbum(tx, albumId) on this table, inside that same locked
      // transaction. Reading via a separate, unlocked `db` connection here
      // would fall outside that lock ordering and could observe stale rows
      // mid-delete (or race a delete that runs between the read and the
      // upsert below); reading through `tx` keeps this entire read-then-write
      // on the one locked session, serialized against both concurrent
      // confirms and delete by the shared album row lock.
      const existing = await albumPhotoRepo.findByAlbum(albumId, tx);
      const statusById = new Map(existing.map((r) => [r.photoId, r.status]));

      const entryRows: AlbumPhotoUpsert[] = (parsed.data.entries ?? []).map((e) => ({
        photoId: e.photoId,
        status: 'uploaded',
        // 署名 = 本次 confirm 执行者(collab rework §3.3):photoId 首次确认或
        // missing→uploaded 流转时落在最后上传者名下。
        uploadedBy: userId,
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
  // 协同白名单读路径(collab plan §5.1/§13):只读的签名 GET 对 owner/editor
  // 开放 —— editor 读图只走服务器 URL,不碰 owner 本地存储。(上传与 confirm
  // 同样是 Creator 能力,见上面两处;删除规则待未来删除 API 按 uploaded_by 实现。)
  async getUrls(
    userId: string,
    albumId: string,
    photoIds: string[],
  ): Promise<Record<string, string>> {
    const album = (await collaborationService.requireAccess(userId, albumId)).album;

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
