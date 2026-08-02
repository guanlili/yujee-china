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
  findByAlbum: async (albumId: string): Promise<AlbumPhoto[]> =>
    db.select().from(albumPhotos).where(eq(albumPhotos.albumId, albumId)),

  // Upsert on the (albumId, photoId) composite PK. A 'missing' row must never
  // downgrade an already-'uploaded' row (nor clobber its width/height/bytes) —
  // the CASE keeps the existing uploaded row's values whenever the incoming
  // status is 'missing'.
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
          status: sql`CASE WHEN ${albumPhotos.status} = 'uploaded' THEN ${albumPhotos.status} ELSE excluded.status END`,
          width: sql`CASE WHEN ${albumPhotos.status} = 'uploaded' THEN ${albumPhotos.width} ELSE excluded.width END`,
          height: sql`CASE WHEN ${albumPhotos.status} = 'uploaded' THEN ${albumPhotos.height} ELSE excluded.height END`,
          bytes: sql`CASE WHEN ${albumPhotos.status} = 'uploaded' THEN ${albumPhotos.bytes} ELSE excluded.bytes END`,
          updatedAt: new Date(),
        },
      });
  },

  deleteByAlbum: async (tx: DbOrTx, albumId: string): Promise<void> => {
    await tx.delete(albumPhotos).where(eq(albumPhotos.albumId, albumId));
  },
};
