import { eq, desc } from 'drizzle-orm';
import { db, type DbOrTx } from '../client';
import { albums, type NewAlbum, type Album } from '../schema';


export const albumRepo = {
  findById: async (id: string): Promise<Album | undefined> => {
    const rows = await db.select().from(albums).where(eq(albums.id, id)).limit(1);
    return rows[0];
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
};
