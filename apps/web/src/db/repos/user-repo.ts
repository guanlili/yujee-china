import { desc, eq, gte, sql } from 'drizzle-orm';
import { db, type DbOrTx } from '../client';
import { users, type NewUser, type User } from '../schema';


export const userRepo = {
  findById: async (id: string): Promise<User | undefined> => {
    const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return rows[0];
  },

  count: async (): Promise<number> => {
    const rows = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(users);
    return rows[0]?.total ?? 0;
  },

  countCreatedSince: async (since: Date): Promise<number> => {
    const rows = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(users)
      .where(gte(users.createdAt, since));
    return rows[0]?.total ?? 0;
  },

  listRecent: async (limit = 50, offset = 0): Promise<User[]> =>
    db
      .select()
      .from(users)
      .orderBy(desc(users.createdAt))
      .limit(limit)
      .offset(offset),

  findByEmail: async (email: string): Promise<User | undefined> => {
    const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
    return rows[0];
  },

  upsertById: async (tx: DbOrTx, data: NewUser): Promise<User> => {
    if (data.id) {
      const existing = await tx.select().from(users).where(eq(users.id, data.id)).limit(1);
      if (existing[0]) return existing[0];
    }
    const inserted = await tx.insert(users).values(data).returning();
    return inserted[0]!;
  },

  updateCredit: async (tx: DbOrTx, id: string, delta: number): Promise<void> => {
    await tx
      .update(users)
      .set({
        creditBalance: sql`${users.creditBalance} + ${delta}`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id));
  },
};
