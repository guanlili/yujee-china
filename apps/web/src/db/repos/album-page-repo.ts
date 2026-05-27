import { eq, asc, and } from 'drizzle-orm';
import { db, type DbOrTx } from '../client';
import { albumPages, type NewAlbumPage, type AlbumPage } from '../schema';


export const albumPageRepo = {
  findByAlbum: async (albumId: string): Promise<AlbumPage[]> =>
    db
      .select()
      .from(albumPages)
      .where(eq(albumPages.albumId, albumId))
      .orderBy(asc(albumPages.pageIndex)),

  bulkInsert: async (tx: DbOrTx, rows: NewAlbumPage[]): Promise<void> => {
    if (rows.length === 0) return;
    await tx.insert(albumPages).values(rows);
  },

  updateOne: async (
    tx: DbOrTx,
    albumId: string,
    pageIndex: number,
    patch: Partial<Pick<NewAlbumPage, 'imagesJson' | 'textsJson'>>,
  ): Promise<void> => {
    await tx
      .update(albumPages)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(albumPages.albumId, albumId), eq(albumPages.pageIndex, pageIndex)));
  },
};
