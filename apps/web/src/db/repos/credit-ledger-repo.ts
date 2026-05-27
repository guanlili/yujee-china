import { desc, eq, sql } from 'drizzle-orm';
import { db, type DbOrTx } from '../client';
import {
  creditLedger,
  type CreditLedger,
  type NewCreditLedger,
} from '../schema';


export const creditLedgerRepo = {
  findByUser: async (userId: string, limit = 50): Promise<CreditLedger[]> =>
    db
      .select()
      .from(creditLedger)
      .where(eq(creditLedger.userId, userId))
      .orderBy(desc(creditLedger.createdAt))
      .limit(limit),

  sumByUser: async (userId: string): Promise<number> => {
    const rows = await db
      .select({ total: sql<number>`coalesce(sum(${creditLedger.delta}), 0)::int` })
      .from(creditLedger)
      .where(eq(creditLedger.userId, userId));
    return rows[0]?.total ?? 0;
  },

  // Webhook idempotency probe (Stripe / Creem event id stored in meta).
  findByExternalEventId: async (eventId: string): Promise<CreditLedger | undefined> => {
    const rows = await db
      .select()
      .from(creditLedger)
      .where(sql`${creditLedger.meta}->>'external_event_id' = ${eventId}`)
      .limit(1);
    return rows[0];
  },

  create: async (tx: DbOrTx, data: NewCreditLedger): Promise<CreditLedger> => {
    const rows = await tx.insert(creditLedger).values(data).returning();
    return rows[0]!;
  },
};
