import { and, eq, sql } from 'drizzle-orm';
import { db, type DbOrTx } from '../client';
import { creditHolds, type NewCreditHold, type CreditHold } from '../schema';


export const creditHoldRepo = {
  findById: async (id: string): Promise<CreditHold | undefined> => {
    const rows = await db
      .select()
      .from(creditHolds)
      .where(eq(creditHolds.id, id))
      .limit(1);
    return rows[0];
  },

  create: async (tx: DbOrTx, data: NewCreditHold): Promise<CreditHold> => {
    const rows = await tx.insert(creditHolds).values(data).returning();
    return rows[0]!;
  },

  update: async (tx: DbOrTx, id: string, patch: Partial<NewCreditHold>): Promise<void> => {
    await tx.update(creditHolds).set(patch).where(eq(creditHolds.id, id));
  },

  /** 该用户所有在途(HOLDING)预留的合计。可用额度 = credit_balance - 这个数;
   *  守门方(creditService.hold)必须在锁住用户行的同一事务里调它。 */
  sumHoldingByUser: async (tx: DbOrTx, userId: string): Promise<number> => {
    const rows = await tx
      .select({ total: sql<number>`coalesce(sum(${creditHolds.amount}), 0)::int` })
      .from(creditHolds)
      .where(and(eq(creditHolds.userId, userId), eq(creditHolds.status, 'HOLDING')));
    return rows[0]?.total ?? 0;
  },

  // Atomic guard: flip HOLDING → `to` only if the row is still HOLDING, and
  // report whether *this* call won the transition. The conditional WHERE makes
  // it the single source of truth even when concurrent callers race the same
  // hold (read-path zombie sweep + daily cron + agent callback), so the ledger
  // crumb is written exactly once. Returns false if someone else already moved it.
  transitionFromHolding: async (
    tx: DbOrTx,
    id: string,
    to: 'SETTLED' | 'RELEASED',
    patch: Partial<NewCreditHold> = {},
  ): Promise<boolean> => {
    const rows = await tx
      .update(creditHolds)
      .set({ status: to, ...patch })
      .where(and(eq(creditHolds.id, id), eq(creditHolds.status, 'HOLDING')))
      .returning({ id: creditHolds.id });
    return rows.length > 0;
  },
};
