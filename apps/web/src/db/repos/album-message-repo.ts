import { asc, desc, eq } from 'drizzle-orm';
import { db, type DbOrTx } from '../client';
import { albumMessages, type AlbumMessage, type NewAlbumMessage } from '../schema';


export const albumMessageRepo = {
  findByAlbum: async (albumId: string): Promise<AlbumMessage[]> =>
    db
      .select()
      .from(albumMessages)
      .where(eq(albumMessages.albumId, albumId))
      .orderBy(asc(albumMessages.createdAt)),

  findRecentByAlbum: async (albumId: string, limit: number): Promise<AlbumMessage[]> => {
    const rows = await db
      .select()
      .from(albumMessages)
      .where(eq(albumMessages.albumId, albumId))
      .orderBy(desc(albumMessages.createdAt))
      .limit(limit);
    return rows.reverse();
  },

  create: async (tx: DbOrTx, data: NewAlbumMessage): Promise<AlbumMessage> => {
    const rows = await tx.insert(albumMessages).values(data).returning();
    return rows[0]!;
  },
};
