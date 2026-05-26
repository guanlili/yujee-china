import { eq } from 'drizzle-orm';
import { db } from '../client';
import { creditHolds, type NewCreditHold, type CreditHold } from '../schema';

type Tx = typeof db;

export const creditHoldRepo = {
  findById: async (id: string): Promise<CreditHold | undefined> =>
    db.select().from(creditHolds).where(eq(creditHolds.id, id)).get(),

  create: async (tx: Tx, data: NewCreditHold): Promise<CreditHold> => {
    return tx.insert(creditHolds).values(data).returning().get();
  },

  update: async (tx: Tx, id: string, patch: Partial<NewCreditHold>): Promise<void> => {
    tx.update(creditHolds).set(patch).where(eq(creditHolds.id, id)).run();
  },
};
