import { eq } from 'drizzle-orm';
import { db } from '../client';
import { users, type NewUser, type User } from '../schema';

type Tx = typeof db;

export const userRepo = {
  findById: async (id: string): Promise<User | undefined> =>
    db.select().from(users).where(eq(users.id, id)).get(),

  upsertById: async (tx: Tx, data: NewUser): Promise<User> => {
    const existing = await tx.select().from(users).where(eq(users.id, data.id!)).get();
    if (existing) return existing;
    const inserted = await tx.insert(users).values(data).returning().get();
    return inserted!;
  },

  updateCredit: async (tx: Tx, id: string, delta: number): Promise<void> => {
    const u = await tx.select().from(users).where(eq(users.id, id)).get();
    if (!u) return;
    await tx.update(users).set({ creditBalance: u.creditBalance + delta }).where(eq(users.id, id)).run();
  },
};
