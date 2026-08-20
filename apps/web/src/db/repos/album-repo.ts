import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { db, type DbOrTx } from '../client';
import { albums, creditHolds, users, type NewAlbum, type Album } from '../schema';

type AlbumStatus = Album['status'];


export const albumRepo = {
  findById: async (id: string): Promise<Album | undefined> => {
    const rows = await db.select().from(albums).where(eq(albums.id, id)).limit(1);
    return rows[0];
  },

  // Row-locked read for workflows that merge JSON progress into draft_json.
  // Callers must use it inside a transaction.
  findByIdForUpdate: async (tx: DbOrTx, id: string): Promise<Album | undefined> => {
    const rows = await tx
      .select()
      .from(albums)
      .where(eq(albums.id, id))
      .for('update')
      .limit(1);
    return rows[0];
  },

  count: async (): Promise<number> => {
    const rows = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(albums);
    return rows[0]?.total ?? 0;
  },

  countCreatedSince: async (since: Date): Promise<number> => {
    const rows = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(albums)
      .where(gte(albums.createdAt, since));
    return rows[0]?.total ?? 0;
  },

  countByStatus: async (): Promise<{ status: AlbumStatus; count: number }[]> =>
    db
      .select({ status: albums.status, count: sql<number>`count(*)::int` })
      .from(albums)
      .groupBy(albums.status),

  countByUserIds: async (userIds: string[]): Promise<{ userId: string; count: number }[]> => {
    if (userIds.length === 0) return [];
    return db
      .select({ userId: albums.userId, count: sql<number>`count(*)::int` })
      .from(albums)
      .where(inArray(albums.userId, userIds))
      .groupBy(albums.userId);
  },

  /** 每个用户最新一本相册的 id。后台用户列表把「相册数」做成可点链接用 ——
   *  一个用户可能有多本,这里只给最新的那本(游客上限就是 1 本,对他们即全部)。
   *  DISTINCT ON 一次查完,不按用户数发 N 条查询。 */
  latestIdByUserIds: async (userIds: string[]): Promise<{ userId: string; albumId: string }[]> => {
    if (userIds.length === 0) return [];
    const rows = await db
      .selectDistinctOn([albums.userId], { userId: albums.userId, albumId: albums.id })
      .from(albums)
      .where(inArray(albums.userId, userIds))
      .orderBy(albums.userId, desc(albums.createdAt), desc(albums.id));
    return rows;
  },

  /** 待清理的死 FAILED 相册。**游客名下的一律排除** —— 否则是个两步后门:游客唯一那本
   *  书 FAILED → 第 30 天被这里删掉 → 次日他就变成「空游客」被 cleanupAnonymous 清掉,
   *  绕过了「做过书的游客永久保留」。而生成失败的那批恰恰是转化诊断价值最高的样本。 */
  findFailedOlderThan: async (cutoff: Date): Promise<Album[]> =>
    db
      .select()
      .from(albums)
      .where(
        and(
          eq(albums.status, 'FAILED'),
          lt(albums.createdAt, cutoff),
          sql`NOT EXISTS (SELECT 1 FROM ${users} WHERE ${users.id} = ${albums.userId} AND ${users.isAnonymous})`,
        ),
      ),

  // draft-expiry sweep (rebuild-tech-plan §12): an init succeeded (album EDITING,
  // draft_json written, NOT yet finalized so layout_json is null) but the user
  // never came back to finalize — its credit hold is still HOLDING and the album
  // has been idle (updated_at) past the cutoff. Returns the (albumId, holdId)
  // pairs whose hold should be released. layout_json IS NULL is the key guard: a
  // finalized album is not an idle draft. Joining HOLDING holds keeps already
  // released/settled drafts out, so the sweep is naturally idempotent.
  findExpiredDrafts: async (
    cutoff: Date,
  ): Promise<{ albumId: string; holdId: string }[]> =>
    db
      .select({ albumId: albums.id, holdId: creditHolds.id })
      .from(albums)
      .innerJoin(
        creditHolds,
        and(eq(creditHolds.albumId, albums.id), eq(creditHolds.status, 'HOLDING')),
      )
      .where(
        and(
          eq(albums.status, 'EDITING'),
          isNotNull(albums.draftJson),
          isNull(albums.layoutJson),
          lt(albums.updatedAt, cutoff),
        ),
      ),

  // Per-album variant of findExpiredDrafts for the read-time opportunistic sweep
  // (albumService.getDetail / listByUser): is THIS album an expired idle draft?
  // Returns the HOLDING hold id to release, or null. Same predicate as the cron
  // query, scoped to one album.
  findExpiredDraftHold: async (
    albumId: string,
    cutoff: Date,
  ): Promise<string | null> => {
    const rows = await db
      .select({ holdId: creditHolds.id })
      .from(albums)
      .innerJoin(
        creditHolds,
        and(eq(creditHolds.albumId, albums.id), eq(creditHolds.status, 'HOLDING')),
      )
      .where(
        and(
          eq(albums.id, albumId),
          eq(albums.status, 'EDITING'),
          isNotNull(albums.draftJson),
          isNull(albums.layoutJson),
          lt(albums.updatedAt, cutoff),
        ),
      )
      .limit(1);
    return rows[0]?.holdId ?? null;
  },

  findByUser: async (userId: string): Promise<Album[]> =>
    db
      .select()
      .from(albums)
      .where(eq(albums.userId, userId))
      .orderBy(desc(albums.createdAt)),

  create: async (tx: DbOrTx, data: NewAlbum): Promise<Album> => {
    const rows = await tx.insert(albums).values(data).returning();
    return rows[0]!;
  },

  update: async (tx: DbOrTx, id: string, patch: Partial<NewAlbum>): Promise<void> => {
    await tx
      .update(albums)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(albums.id, id));
  },

  // Conditional status transition, mirroring agentJobRepo.transitionStatus: flip
  // status to `to` only if it is currently one of `from`, and report whether
  // *this* call won. Retry uses it to claim FAILED → AGENT_RUNNING exactly once —
  // two concurrent retries (or a retry racing a stale-job sweep) serialize on the
  // row lock; the loser gets 0 rows and must abort before holding credit again.
  transitionStatus: async (
    tx: DbOrTx,
    id: string,
    to: AlbumStatus,
    from: AlbumStatus[],
    patch: Partial<NewAlbum> = {},
  ): Promise<boolean> => {
    const rows = await tx
      .update(albums)
      .set({ ...patch, status: to, updatedAt: new Date() })
      .where(and(eq(albums.id, id), inArray(albums.status, from)))
      .returning({ id: albums.id });
    return rows.length > 0;
  },

  delete: async (tx: DbOrTx, id: string): Promise<void> => {
    await tx.delete(albums).where(eq(albums.id, id));
  },
};
