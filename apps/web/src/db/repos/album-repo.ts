import { eq, desc } from 'drizzle-orm';
import { db } from '../client';
import { albums, type NewAlbum, type Album } from '../schema';

type Tx = typeof db;

export const albumRepo = {
  findById: async (id: string): Promise<Album | undefined> =>
    db.select().from(albums).where(eq(albums.id, id)).get(),

  findByUser: async (userId: string): Promise<Album[]> =>
    db.select().from(albums).where(eq(albums.userId, userId)).orderBy(desc(albums.createdAt)).all(),

  create: async (tx: Tx, data: NewAlbum): Promise<Album> => {
    const inserted = tx.insert(albums).values(data).returning().get();
    return inserted;
  },

  update: async (tx: Tx, id: string, patch: Partial<NewAlbum>): Promise<void> => {
    tx.update(albums).set({ ...patch, updatedAt: new Date() }).where(eq(albums.id, id)).run();
  },
};
