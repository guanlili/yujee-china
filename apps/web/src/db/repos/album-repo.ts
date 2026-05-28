import { and, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { db, type DbOrTx } from '../client';
import { albums, type NewAlbum, type Album } from '../schema';

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

  delete: async (tx: DbOrTx, id: string): Promise<void> => {
    await tx.delete(albums).where(eq(albums.id, id));
  },
};
