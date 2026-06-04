import type { DbOrTx } from '@/db/client';
import { subscriptionRepo } from '@/db/repos/subscription-repo';
import type { Subscription } from '@/db/schema';
import { getPlan, type BillingCycle, type CheckoutProvider, type PlanId } from '@/config/pricing';

export type PaidPlanId = Exclude<PlanId, 'free'>;
export type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'canceled' | 'incomplete';

export type ProviderSubscriptionInput = {
  userId: string;
  provider: CheckoutProvider;
  externalCustomerId?: string | null;
  externalSubscriptionId: string;
  planId: PaidPlanId;
  cycle: BillingCycle;
  status: string;
  currentPeriodStart?: Date | null;
  currentPeriodEnd?: Date | null;
  cancelAtPeriodEnd?: boolean;
};

function lastUtcDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function addUtcCalendarMonths(start: Date, months: number): Date {
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth() + months;
  const targetYear = year + Math.floor(month / 12);
  const targetMonth = ((month % 12) + 12) % 12;
  const day = Math.min(start.getUTCDate(), lastUtcDayOfMonth(targetYear, targetMonth));

  return new Date(Date.UTC(
    targetYear,
    targetMonth,
    day,
    start.getUTCHours(),
    start.getUTCMinutes(),
    start.getUTCSeconds(),
    start.getUTCMilliseconds(),
  ));
}

export function addBillingPeriod(start: Date, cycle: BillingCycle): Date {
  return addUtcCalendarMonths(start, cycle === 'yearly' ? 12 : 1);
}

export function normalizeSubscriptionStatus(status: string | null | undefined): SubscriptionStatus {
  if (status === 'trialing') return 'trialing';
  if (status === 'past_due') return 'past_due';
  if (status === 'canceled' || status === 'cancelled') return 'canceled';
  if (status === 'incomplete') return 'incomplete';
  return 'active';
}

export function planLabel(planId: PlanId | null | undefined): string {
  if (!planId || planId === 'free') return 'Free';
  const plan = getPlan(planId);
  return plan.id === 'pro' ? 'Pro' : 'Studio';
}

export const subscriptionService = {
  async getCurrent(userId: string): Promise<Subscription | undefined> {
    return subscriptionRepo.findCurrentByUser(userId);
  },

  async recordProviderSubscription(
    tx: DbOrTx,
    input: ProviderSubscriptionInput,
  ): Promise<Subscription> {
    getPlan(input.planId);
    const currentPeriodStart = input.currentPeriodStart ?? new Date();
    const currentPeriodEnd =
      input.currentPeriodEnd ?? addBillingPeriod(currentPeriodStart, input.cycle);

    return subscriptionRepo.upsertByProviderSubscription(tx, {
      userId: input.userId,
      provider: input.provider,
      externalCustomerId: input.externalCustomerId ?? null,
      externalSubscriptionId: input.externalSubscriptionId,
      planId: input.planId,
      billingCycle: input.cycle,
      status: normalizeSubscriptionStatus(input.status),
      currentPeriodStart,
      currentPeriodEnd,
      cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? false,
    });
  },
};
