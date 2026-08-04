import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
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

  // Case/whitespace-insensitive lookup for hand-typed admin input (e.g. the
  // credit-grant form), where the operator may not match stored casing exactly.
  findByEmailInsensitive: async (email: string): Promise<User | undefined> => {
    const rows = await db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${email.trim().toLowerCase()}`)
      .limit(1);
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

  // 游客清理(cron):创建早于 cutoff 且仍未转正的匿名账号。转正的在 onLinkAccount
  // 时已被插件删掉,这里扫到的只剩「来了没登录」的。limit 分批,防单次事务过大。
  findAnonymousCreatedBefore: async (cutoff: Date, limit = 500): Promise<User[]> =>
    db
      .select()
      .from(users)
      .where(and(eq(users.isAnonymous, true), lt(users.createdAt, cutoff)))
      .orderBy(users.createdAt)
      .limit(limit),

  // 删除用户行:albums/agent_jobs/album_messages/sessions 等 11 处 onDelete:'cascade'
  // 随行清空。仅供游客清理 cron 使用 —— 真实账号删除是产品级流程,不走这里。
  deleteById: async (tx: DbOrTx, id: string): Promise<void> => {
    await tx.delete(users).where(eq(users.id, id));
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
