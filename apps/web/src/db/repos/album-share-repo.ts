import { desc, eq } from 'drizzle-orm';
import { db, type DbOrTx } from '../client';
import { albumShares, type AlbumShare, type NewAlbumShare } from '../schema';

// 相册分享(免登只读)存取。一链接一行(collab rework §3.1):每次 createShare 插入
// 新 token,旧 token 不失效 —— editor 建分享不会撤销 owner 已发的链接。公开读只按
// token 查,不带归属过滤(归属在「生成」时已由 service 校验)。
export const albumShareRepo = {
  findByToken: async (token: string): Promise<AlbumShare | undefined> =>
    db.select().from(albumShares).where(eq(albumShares.token, token)).limit(1).then((r) => r[0]),

  // 最新一条:分享管理 UI(展示当前链接)用;历史行保留只读。
  findLatestByAlbum: async (albumId: string): Promise<AlbumShare | undefined> =>
    db
      .select()
      .from(albumShares)
      .where(eq(albumShares.albumId, albumId))
      .orderBy(desc(albumShares.createdAt))
      .limit(1)
      .then((r) => r[0]),

  // 生成分享:总是插入新行(新 token + 当前快照),不改写已有行。
  create: async (tx: DbOrTx, row: NewAlbumShare): Promise<AlbumShare> => {
    const [saved] = await tx.insert(albumShares).values(row).returning();
    return saved!;
  },
};
