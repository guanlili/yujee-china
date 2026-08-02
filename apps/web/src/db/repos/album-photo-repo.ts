import { eq, sql } from 'drizzle-orm';
import { db, type DbOrTx } from '../client';
import { albumPhotos, type AlbumPhoto } from '../schema';

export type AlbumPhotoUpsert = {
  photoId: string;
  status: 'uploaded' | 'missing';
  width?: number;
  height?: number;
  bytes?: number;
};

export const albumPhotoRepo = {
  // Defaults to the top-level `db` so existing unscoped callers are unchanged;
  // pass the open `tx` explicitly to read inside a transaction (e.g. after a
  // row lock on `albums`, so the read is guaranteed current — see
  // photo-original-service.ts confirm()).
  findByAlbum: async (albumId: string, tx: DbOrTx = db): Promise<AlbumPhoto[]> =>
    tx.select().from(albumPhotos).where(eq(albumPhotos.albumId, albumId)),

  // Upsert on the (albumId, photoId) composite PK. A 'missing' upsert must
  // never downgrade an already-'uploaded' row (nor clobber its
  // width/height/bytes): the gate is on the INCOMING (excluded) status, not
  // the existing row's status. When excluded.status = 'missing', keep the
  // existing row's status/width/height/bytes untouched. Otherwise (incoming
  // is 'uploaded' — including a legitimate re-upload that overwrote the R2
  // object with new dimensions/bytes) take the incoming values, so metadata
  // never goes stale once a row is uploaded.
  upsertMany: async (tx: DbOrTx, albumId: string, rows: AlbumPhotoUpsert[]): Promise<void> => {
    if (rows.length === 0) return;
    await tx
      .insert(albumPhotos)
      .values(
        rows.map((r) => ({
          albumId,
          photoId: r.photoId,
          status: r.status,
          width: r.width ?? null,
          height: r.height ?? null,
          bytes: r.bytes ?? null,
        })),
      )
      .onConflictDoUpdate({
        target: [albumPhotos.albumId, albumPhotos.photoId],
        set: {
          status: sql`CASE WHEN excluded.status = 'missing' THEN ${albumPhotos.status} ELSE excluded.status END`,
          width: sql`CASE WHEN excluded.status = 'missing' THEN ${albumPhotos.width} ELSE excluded.width END`,
          height: sql`CASE WHEN excluded.status = 'missing' THEN ${albumPhotos.height} ELSE excluded.height END`,
          bytes: sql`CASE WHEN excluded.status = 'missing' THEN ${albumPhotos.bytes} ELSE excluded.bytes END`,
          updatedAt: new Date(),
        },
      });
  },

  deleteByAlbum: async (tx: DbOrTx, albumId: string): Promise<void> => {
    await tx.delete(albumPhotos).where(eq(albumPhotos.albumId, albumId));
  },
};
