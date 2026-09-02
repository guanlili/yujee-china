import { eq } from 'drizzle-orm';
import { db, type DbOrTx } from '../client';
import { albumEditLinks, type AlbumEditLink } from '../schema';

// 协同编辑邀请链接(2026-08-27 collab plan §6.2):album_edit_links 的 adapter。
// 只存 token 的 SHA-256 hex —— 明文 token 仅在 service 层创建/旋转时生成并随
// 响应返回一次,绝不落库。一册一行(albumId 主键):upsert 即旋转,旧 hash 消失
// = 旧链接立即失效(最小撤销机制)。
export const albumEditLinkRepo = {
  // 创建或旋转。返回落库后的行(含新 hash 与时间戳)。
  upsert: async (
    tx: DbOrTx,
    albumId: string,
    tokenHash: string,
    createdBy: string,
  ): Promise<AlbumEditLink> => {
    const rows = await tx
      .insert(albumEditLinks)
      .values({ albumId, tokenHash, createdBy })
      .onConflictDoUpdate({
        target: albumEditLinks.albumId,
        set: { tokenHash, createdBy, createdAt: new Date() },
      })
      .returning();
    return rows[0]!;
  },

  // redeem 查找:按明文 token 的 hash 查。旋转后旧 hash 自然 miss。
  findByTokenHash: async (
    tokenHash: string,
    tx: DbOrTx = db,
  ): Promise<AlbumEditLink | undefined> => {
    const rows = await tx
      .select()
      .from(albumEditLinks)
      .where(eq(albumEditLinks.tokenHash, tokenHash))
      .limit(1);
    return rows[0];
  },

  deleteByAlbum: async (tx: DbOrTx, albumId: string): Promise<void> => {
    await tx.delete(albumEditLinks).where(eq(albumEditLinks.albumId, albumId));
  },
};
