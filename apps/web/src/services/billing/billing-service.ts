import { userRepo } from '@/db/repos/user-repo';
import { customerRepo } from '@/db/repos/customer-repo';
import { creditLedgerRepo } from '@/db/repos/credit-ledger-repo';
import { planLabel, subscriptionService } from '@/services/billing/subscription-service';
import { ERRORS } from '@/lib/api/error-codes';

// Read-only billing overview for the dashboard. The old `/order` endpoint is
// gone (migration §8) — purchase history is reconstructed from PURCHASE rows in
// credit_ledger, whose meta carries provider / pack / amount written by the
// Stripe & Creem webhooks.
export const billingService = {
  async getOverview(userId: string) {
    const user = await userRepo.findById(userId);
    if (!user) throw ERRORS.UNAUTHORIZED();

    const customers = await customerRepo.findAllByUser(userId);
    const ledger = await creditLedgerRepo.findByUser(userId, 100);
    const subscription = await subscriptionService.getCurrent(userId);

    const purchases = ledger
      .filter((r) => r.reason === 'PURCHASE')
      .map((r) => {
        const meta = (r.meta ?? {}) as Record<string, unknown>;
        return {
          id: r.id,
          credits: r.delta,
          amountCents: typeof meta.amount_cents === 'number' ? meta.amount_cents : null,
          provider: typeof meta.provider === 'string' ? meta.provider : null,
          packId: typeof meta.pack_id === 'string' ? meta.pack_id : null,
          createdAt: r.createdAt,
        };
      });

    return {
      balance: user.creditBalance,
      providers: customers.map((c) => c.provider),
      subscription: subscription
        ? {
            planId: subscription.planId,
            label: planLabel(subscription.planId as any),
            cycle: subscription.billingCycle,
            status: subscription.status,
            currentPeriodEnd: subscription.currentPeriodEnd,
          }
        : {
            planId: 'free',
            label: 'Free',
            cycle: null,
            status: 'free',
            currentPeriodEnd: null,
          },
      purchases,
    };
  },
};
