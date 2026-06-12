import { eq, asc, and, inArray } from 'drizzle-orm';
import { db, type DbOrTx } from '../client';
import { albumPages, type NewAlbumPage, type AlbumPage } from '../schema';


export const albumPageRepo = {
  findByAlbum: async (albumId: string): Promise<AlbumPage[]> =>
    db
      .select()
      .from(albumPages)
      .where(eq(albumPages.albumId, albumId))
      .orderBy(asc(albumPages.pageIndex)),

  findFirstByAlbumIds: async (
    albumIds: string[],
  ): Promise<Pick<AlbumPage, 'albumId' | 'pageIndex' | 'templateId' | 'imagesJson' | 'textsJson'>[]> => {
    if (albumIds.length === 0) return [];
    return db
      .select({
        albumId: albumPages.albumId,
        pageIndex: albumPages.pageIndex,
        templateId: albumPages.templateId,
        imagesJson: albumPages.imagesJson,
        textsJson: albumPages.textsJson,
      })
      .from(albumPages)
      .where(and(inArray(albumPages.albumId, albumIds), eq(albumPages.pageIndex, 0)));
  },

  bulkInsert: async (tx: DbOrTx, rows: NewAlbumPage[]): Promise<void> => {
    if (rows.length === 0) return;
    await tx.insert(albumPages).values(rows);
  },

  // Wipe an album's pages so the caller can rebuild the full set (W11 add-photos:
  // new pages slot before the ending, shifting the ending's pageIndex — a
  // delete-then-bulkInsert avoids juggling the unique(albumId, pageIndex) index).
  deleteByAlbum: async (tx: DbOrTx, albumId: string): Promise<void> => {
    await tx.delete(albumPages).where(eq(albumPages.albumId, albumId));
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
