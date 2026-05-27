import { eq } from 'drizzle-orm';
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
};
