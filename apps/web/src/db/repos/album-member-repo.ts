import { and, asc, eq, inArray } from 'drizzle-orm';
import { db, type DbOrTx } from '../client';
import { albumMembers, type AlbumMember } from '../schema';

// 协同编辑成员(2026-08-27 collab plan §6.1):album_members 的 adapter。这张表
// 只表达 editor —— owner 永远不插入(albums.user_id 是 owner 的唯一真相),服务层
// 负责保证这一点;repo 只做数据存取。所有改变成员集合的写操作都应在相册行锁
// 事务内进行,与 redeem 的结构/AI 派发串行。
export const albumMemberRepo = {
  exists: async (albumId: string, userId: string, tx: DbOrTx = db): Promise<boolean> => {
    const rows = await tx
      .select({ userId: albumMembers.userId })
      .from(albumMembers)
      .where(and(eq(albumMembers.albumId, albumId), eq(albumMembers.userId, userId)))
      .limit(1);
    return rows.length > 0;
  },

  // redeem 落库:ON CONFLICT DO NOTHING —— 重复打开邀请链接幂等,不抛错、
  // 不覆盖 created_at(首个加入时间保留)。owner 不得写入由调用方保证。
  addMemberIfAbsent: async (tx: DbOrTx, albumId: string, userId: string): Promise<void> => {
    await tx
      .insert(albumMembers)
      .values({ albumId, userId })
      .onConflictDoNothing({ target: [albumMembers.albumId, albumMembers.userId] });
  },

  // owner 移除成员。返回是否真的删了行 —— false 用于幂等(重复移除不报错)。
  removeMember: async (
    tx: DbOrTx,
    albumId: string,
    userId: string,
  ): Promise<boolean> => {
    const removed = await tx
      .delete(albumMembers)
      .where(and(eq(albumMembers.albumId, albumId), eq(albumMembers.userId, userId)))
      .returning({ userId: albumMembers.userId });
    return removed.length > 0;
  },

  // 成员列表 UI(Task 8):按加入时间正序。join users 由服务层做(保持 repo 单表)。
  // 批量存在性(my-albums 列表用,2026-10-29):一次 IN 查询替代逐本 exists
  // 的 N+1;语义与循环调用 exists 相同(读到什么就是什么,不加事务)。
  albumIdsForUser: async (
    albumIds: string[],
    userId: string,
    tx: DbOrTx = db,
  ): Promise<Set<string>> => {
    if (albumIds.length === 0) return new Set();
    const rows = await tx
      .select({ albumId: albumMembers.albumId })
      .from(albumMembers)
      .where(and(eq(albumMembers.userId, userId), inArray(albumMembers.albumId, albumIds)));
    return new Set(rows.map((row) => row.albumId));
  },

  listByAlbum: async (albumId: string, tx: DbOrTx = db): Promise<AlbumMember[]> =>
    tx
      .select()
      .from(albumMembers)
      .where(eq(albumMembers.albumId, albumId))
      .orderBy(asc(albumMembers.createdAt)),
};
