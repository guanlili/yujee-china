import { eq } from 'drizzle-orm';
import { db, type DbOrTx } from '../client';
import { albumShares, type AlbumShare, type NewAlbumShare } from '../schema';

// 相册分享(免登只读)存取。一相册一条(uniq album_id):重新生成 = upsert 覆盖同一行,
// token 换新。公开读只按 token 查,不带归属过滤(归属在「生成」时已由 service 校验)。
export const albumShareRepo = {
  findByToken: async (token: string): Promise<AlbumShare | undefined> =>
    db.select().from(albumShares).where(eq(albumShares.token, token)).limit(1).then((r) => r[0]),

  findByAlbum: async (albumId: string): Promise<AlbumShare | undefined> =>
    db.select().from(albumShares).where(eq(albumShares.albumId, albumId)).limit(1).then((r) => r[0]),

  // 生成/重新生成:同 albumId 已有则覆盖(换 token + 新快照),否则插入。
  upsertByAlbum: async (tx: DbOrTx, row: NewAlbumShare): Promise<AlbumShare> => {
    const [saved] = await tx
      .insert(albumShares)
      .values(row)
      .onConflictDoUpdate({
        target: albumShares.albumId,
        set: {
          token: row.token,
          title: row.title,
          snapshotJson: row.snapshotJson,
          updatedAt: new Date(),
        },
      })
      .returning();
    return saved!;
  },
};
