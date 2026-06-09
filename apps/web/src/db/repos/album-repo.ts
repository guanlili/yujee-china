import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { db, type DbOrTx } from '../client';
import { albums, creditHolds, type NewAlbum, type Album } from '../schema';

type AlbumStatus = Album['status'];


export const albumRepo = {
  findById: async (id: string): Promise<Album | undefined> => {
    const rows = await db.select().from(albums).where(eq(albums.id, id)).limit(1);
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

  findFailedOlderThan: async (cutoff: Date): Promise<Album[]> =>
    db
      .select()
      .from(albums)
      .where(and(eq(albums.status, 'FAILED'), lt(albums.createdAt, cutoff))),

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
