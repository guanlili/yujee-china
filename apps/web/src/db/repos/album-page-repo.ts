import { eq, asc, and } from 'drizzle-orm';
import { db } from '../client';
import { albumPages, type NewAlbumPage, type AlbumPage } from '../schema';

type Tx = typeof db;

export const albumPageRepo = {
  findByAlbum: async (albumId: string): Promise<AlbumPage[]> =>
    db.select().from(albumPages).where(eq(albumPages.albumId, albumId)).orderBy(asc(albumPages.pageIndex)).all(),

  bulkInsert: async (tx: Tx, rows: NewAlbumPage[]): Promise<void> => {
    if (rows.length === 0) return;
    tx.insert(albumPages).values(rows).run();
  },

  updateOne: async (
    tx: Tx,
    albumId: string,
    pageIndex: number,
    patch: Partial<Pick<NewAlbumPage, 'imagesJson' | 'textsJson'>>,
  ): Promise<void> => {
    tx.update(albumPages)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(albumPages.albumId, albumId), eq(albumPages.pageIndex, pageIndex)))
      .run();
  },
};
