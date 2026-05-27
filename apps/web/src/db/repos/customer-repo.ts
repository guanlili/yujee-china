import { and, eq } from 'drizzle-orm';
import { db, type DbOrTx } from '../client';
import {
  customers,
  type Customer,
  type NewCustomer,
  type customerProviderEnum,
} from '../schema';

type Provider = (typeof customerProviderEnum.enumValues)[number];

export const customerRepo = {
  findByUserAndProvider: async (
    userId: string,
    provider: Provider,
  ): Promise<Customer | undefined> => {
    const rows = await db
      .select()
      .from(customers)
      .where(and(eq(customers.userId, userId), eq(customers.provider, provider)))
      .limit(1);
    return rows[0];
  },

  findByProviderExternalId: async (
    provider: Provider,
    externalCustomerId: string,
  ): Promise<Customer | undefined> => {
    const rows = await db
      .select()
      .from(customers)
      .where(
        and(eq(customers.provider, provider), eq(customers.externalCustomerId, externalCustomerId)),
      )
      .limit(1);
    return rows[0];
  },

  findAllByUser: async (userId: string): Promise<Customer[]> =>
    db.select().from(customers).where(eq(customers.userId, userId)),

  create: async (tx: DbOrTx, data: NewCustomer): Promise<Customer> => {
    const rows = await tx.insert(customers).values(data).returning();
    return rows[0]!;
  },

  update: async (tx: DbOrTx, id: string, patch: Partial<NewCustomer>): Promise<void> => {
    await tx
      .update(customers)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(customers.id, id));
  },
};
