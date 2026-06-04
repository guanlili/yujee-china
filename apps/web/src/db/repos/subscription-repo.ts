import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { db, type DbOrTx } from '../client';
import {
  subscriptions,
  type NewSubscription,
  type Subscription,
  type customerProviderEnum,
} from '../schema';

type Provider = (typeof customerProviderEnum.enumValues)[number];

const activeStatuses = ['active', 'trialing'] as const;

export const subscriptionRepo = {
  findCurrentByUser: async (
    userId: string,
    now: Date = new Date(),
  ): Promise<Subscription | undefined> => {
    const rows = await db
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.userId, userId),
          inArray(subscriptions.status, [...activeStatuses]),
          gte(subscriptions.currentPeriodEnd, now),
        ),
      )
      .orderBy(desc(subscriptions.currentPeriodEnd))
      .limit(1);
    return rows[0];
  },

  upsertByProviderSubscription: async (
    tx: DbOrTx,
    data: NewSubscription,
  ): Promise<Subscription> => {
    const rows = await tx
      .insert(subscriptions)
      .values(data)
      .onConflictDoUpdate({
        target: [subscriptions.provider, subscriptions.externalSubscriptionId],
        set: {
          userId: data.userId,
          externalCustomerId: data.externalCustomerId ?? null,
          planId: data.planId,
          billingCycle: data.billingCycle,
          status: data.status,
          currentPeriodStart: data.currentPeriodStart,
          currentPeriodEnd: data.currentPeriodEnd,
          cancelAtPeriodEnd: data.cancelAtPeriodEnd ?? false,
          updatedAt: new Date(),
        },
      })
      .returning();
    return rows[0]!;
  },

  updateStatusByProviderSubscription: async (
    tx: DbOrTx,
    provider: Provider,
    externalSubscriptionId: string,
    patch: Partial<Pick<NewSubscription, 'status' | 'currentPeriodEnd' | 'cancelAtPeriodEnd'>>,
  ): Promise<void> => {
    await tx
      .update(subscriptions)
      .set({ ...patch, updatedAt: new Date() })
      .where(
        and(
          eq(subscriptions.provider, provider),
          eq(subscriptions.externalSubscriptionId, externalSubscriptionId),
        ),
      );
  },
};
