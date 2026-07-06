import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { db, type DbOrTx } from '../client';
import { albumMessages, type AlbumMessage, type NewAlbumMessage } from '../schema';

// 写入时不需要调用方给 seq:repo 按相册单调自增分配。
export type NewAlbumMessageInput = Omit<NewAlbumMessage, 'seq'>;

export const albumMessageRepo = {
  findByAlbum: async (albumId: string): Promise<AlbumMessage[]> =>
    db
      .select()
      .from(albumMessages)
      .where(eq(albumMessages.albumId, albumId))
      .orderBy(asc(albumMessages.seq)),

  findRecentByAlbum: async (albumId: string, limit: number): Promise<AlbumMessage[]> => {
    const rows = await db
      .select()
      .from(albumMessages)
      .where(eq(albumMessages.albumId, albumId))
      .orderBy(desc(albumMessages.seq))
      .limit(limit);
    return rows.reverse();
  },

  // v2 chapter-chat (W9): the per-chapter history slice. chapter-chat is scoped
  // to one chapter (architecture §3), so the resent history is just THIS chapter's
  // turns, newest-limited then re-ordered oldest→newest. Ordered by the append-order
  // seq (idx_album_messages_album_chapter_seq).
  findRecentByAlbumChapter: async (
    albumId: string,
    chapterId: string,
    limit: number,
  ): Promise<AlbumMessage[]> => {
    const rows = await db
      .select()
      .from(albumMessages)
      .where(and(eq(albumMessages.albumId, albumId), eq(albumMessages.chapterId, chapterId)))
      .orderBy(desc(albumMessages.seq))
      .limit(limit);
    return rows.reverse();
  },

  // 发生即追加:每条消息在插入时拿到该相册的下一个 seq(同事务内多条依次 max+1 递增,
  // 顺序 = 写入顺序)。唯一(album, seq) 索引兜底并发,不再靠 created_at 凑序。
  create: async (tx: DbOrTx, data: NewAlbumMessageInput): Promise<AlbumMessage> => {
    const [{ nextSeq }] = await tx
      .select({
        nextSeq: sql<number>`(coalesce(max(${albumMessages.seq}), 0) + 1)::int`,
      })
      .from(albumMessages)
      .where(eq(albumMessages.albumId, data.albumId));
    const rows = await tx
      .insert(albumMessages)
      .values({ ...data, seq: Number(nextSeq) })
      .returning();
    return rows[0]!;
  },
};
