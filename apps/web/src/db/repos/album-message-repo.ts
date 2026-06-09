import { and, asc, desc, eq } from 'drizzle-orm';
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

  // v2 chapter-chat (W9): the per-chapter history slice. chapter-chat is scoped
  // to one chapter (architecture §3), so the resent history is just THIS chapter's
  // turns, newest-limited then re-ordered oldest→newest. Backed by the
  // idx_album_messages_album_chapter_created index.
  findRecentByAlbumChapter: async (
    albumId: string,
    chapterId: string,
    limit: number,
  ): Promise<AlbumMessage[]> => {
    const rows = await db
      .select()
      .from(albumMessages)
      .where(and(eq(albumMessages.albumId, albumId), eq(albumMessages.chapterId, chapterId)))
      .orderBy(desc(albumMessages.createdAt))
      .limit(limit);
    return rows.reverse();
  },

  create: async (tx: DbOrTx, data: NewAlbumMessage): Promise<AlbumMessage> => {
    const rows = await tx.insert(albumMessages).values(data).returning();
    return rows[0]!;
  },
};
