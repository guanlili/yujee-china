import Stripe from 'stripe';
import { db } from '@/db/client';
import { customerRepo } from '@/db/repos/customer-repo';
import { userRepo } from '@/db/repos/user-repo';
import { creditLedgerRepo } from '@/db/repos/credit-ledger-repo';
import { creditService } from '@/services/credit/credit-service';
import {
  ADDON_PACKS,
  buildSubscriptionReturnUrls,
  buildCheckoutReturnUrls,
  getPlan,
  planPriceFor,
  type BillingCycle,
  type CheckoutReturnContext,
} from '@/config/pricing';
import { subscriptionService, type PaidPlanId } from '@/services/billing/subscription-service';
import { env } from '@/lib/env';
import { ERRORS } from '@/lib/api/error-codes';
import { logger } from '@/lib/log/logger';

let _stripe: Stripe | null = null;
function client(): Stripe {
  if (!env.STRIPE_API_KEY) throw ERRORS.BILLING_NOT_CONFIGURED();
  if (!_stripe) _stripe = new Stripe(env.STRIPE_API_KEY);
  return _stripe;
}

export const stripeService = {
  // One-shot credit pack purchase via Stripe Checkout. Returns the hosted URL
  // for the client to redirect to.
  async createPackCheckout(
    userId: string,
    packId: string,
    context: CheckoutReturnContext = {},
  ): Promise<{ url: string }> {
    const pack = ADDON_PACKS.find((p) => p.id === packId);
    if (!pack) throw ERRORS.VALIDATION_FAILED(`Unknown pack: ${packId}`);

    const user = await userRepo.findById(userId);
    if (!user) throw ERRORS.UNAUTHORIZED();

    const customerId = await ensureCustomer(userId, user.email);
    const stripe = client();
    const { successUrl, cancelUrl } = buildCheckoutReturnUrls(
      env.WEB_BASE_URL,
      'stripe',
      context,
    );
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer: customerId,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            unit_amount: Math.round(pack.priceUsd * 100),
            product_data: { name: `${pack.credits} Yujee credits` },
          },
          quantity: 1,
        },
      ],
      // Webhook keys off this metadata to credit the right user.
      metadata: { userId, kind: 'pack', packId },
      success_url: successUrl,
      cancel_url: cancelUrl,
    });
    if (!session.url) throw ERRORS.INTERNAL_ERROR();
    return { url: session.url };
  },

  async createSubscriptionCheckout(
    userId: string,
    planId: PaidPlanId,
    cycle: BillingCycle,
    context: Pick<CheckoutReturnContext, 'locale'> = {},
  ): Promise<{ url: string }> {
    const plan = getPlan(planId);
    if (plan.id === 'free') throw ERRORS.VALIDATION_FAILED('free plan is not subscribable');

    const user = await userRepo.findById(userId);
    if (!user) throw ERRORS.UNAUTHORIZED();

    const customerId = await ensureCustomer(userId, user.email);
    const stripe = client();
    const metadata = { userId, kind: 'subscription', planId, cycle };
    const { successUrl, cancelUrl } = buildSubscriptionReturnUrls(
      env.WEB_BASE_URL,
      'stripe',
      context,
    );
    const monthlyDisplayPrice = planPriceFor(plan, cycle);
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            unit_amount: Math.round(monthlyDisplayPrice * (cycle === 'yearly' ? 12 : 1) * 100),
            recurring: { interval: cycle === 'yearly' ? 'year' : 'month' },
            product_data: { name: `Yujee ${plan.id}` },
          },
          quantity: 1,
        },
      ],
      metadata,
      subscription_data: { metadata },
      success_url: successUrl,
      cancel_url: cancelUrl,
    });
    if (!session.url) throw ERRORS.INTERNAL_ERROR();
    return { url: session.url };
  },

  async handleWebhook(rawBody: string, signature: string | null): Promise<void> {
    if (!env.STRIPE_WEBHOOK_SECRET) throw ERRORS.WEBHOOK_NOT_CONFIGURED();
    if (!signature) throw ERRORS.WEBHOOK_SIGNATURE_INVALID();
    const stripe = client();
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
    } catch (e) {
      logger.warn({ err: String(e) }, 'stripe webhook signature failed');
      throw ERRORS.WEBHOOK_SIGNATURE_INVALID();
    }

    // Two-layer idempotency: cheap lookup first, then a UNIQUE constraint on
    // credit_ledger.meta->>'external_event_id' as the hard backstop for races.
    const existing = await creditLedgerRepo.findByExternalEventId(event.id);
    if (existing) {
      logger.info({ eventId: event.id, type: event.type }, 'stripe webhook duplicate, skipped');
      return;
    }

    if (event.type === 'checkout.session.completed') {
      await applyCheckoutCompleted(event.data.object as Stripe.Checkout.Session, event.id);
    } else if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      await applySubscription(event.data.object as Stripe.Subscription);
    } else {
      logger.info({ type: event.type, eventId: event.id }, 'stripe webhook ignored');
    }
  },
};

async function ensureCustomer(userId: string, email: string | null | undefined): Promise<string> {
  const existing = await customerRepo.findByUserAndProvider(userId, 'stripe');
  if (existing) return existing.externalCustomerId;
  const stripe = client();
  const customer = await stripe.customers.create({
    email: email ?? undefined,
    metadata: { userId },
  });
  await customerRepo.create(db, {
    userId,
    provider: 'stripe',
    externalCustomerId: customer.id,
    email: email ?? null,
  });
  return customer.id;
}

async function applyCheckoutCompleted(
  session: Stripe.Checkout.Session,
  eventId: string,
): Promise<void> {
  const userId = session.metadata?.userId;
  const kind = session.metadata?.kind;
  if (kind === 'subscription') {
    await applySubscriptionCheckoutCompleted(session);
    return;
  }

  const packId = session.metadata?.packId;
  if (!userId || kind !== 'pack' || !packId) {
    logger.warn({ sessionId: session.id, eventId }, 'stripe checkout metadata incomplete');
    return;
  }
  const pack = ADDON_PACKS.find((p) => p.id === packId);
  if (!pack) {
    logger.warn({ sessionId: session.id, packId }, 'stripe pack unknown');
    return;
  }

  await db.transaction(async (tx) => {
    await creditService.applyDelta(tx, userId, pack.credits, 'PURCHASE', {
      externalEventId: eventId,
      meta: {
        provider: 'stripe',
        session_id: session.id,
        pack_id: pack.id,
        amount_cents: Math.round(pack.priceUsd * 100),
      },
    });
  });

  logger.info(
    { userId, packId, credits: pack.credits, eventId },
    'stripe purchase credited',
  );
}

async function applySubscriptionCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const subscriptionId = typeof session.subscription === 'string'
    ? session.subscription
    : session.subscription?.id;
  if (!subscriptionId) {
    logger.warn({ sessionId: session.id }, 'stripe subscription checkout missing subscription id');
    return;
  }
  const subscription = await client().subscriptions.retrieve(subscriptionId);
  await applySubscription(subscription);
}

async function applySubscription(subscription: Stripe.Subscription): Promise<void> {
  const meta = subscription.metadata ?? {};
  const userId = meta.userId;
  const planId = meta.planId;
  const cycle = meta.cycle;
  if (!userId || !isPaidPlanId(planId) || !isBillingCycle(cycle)) {
    logger.warn({ subscriptionId: subscription.id }, 'stripe subscription metadata incomplete');
    return;
  }

  const currentPeriodStart = stripeSecondsToDate((subscription as any).current_period_start) ?? new Date();
  const currentPeriodEnd =
    stripeSecondsToDate((subscription as any).current_period_end) ?? undefined;

  await db.transaction(async (tx) => {
    await subscriptionService.recordProviderSubscription(tx, {
      userId,
      provider: 'stripe',
      externalCustomerId: typeof subscription.customer === 'string'
        ? subscription.customer
        : subscription.customer?.id ?? null,
      externalSubscriptionId: subscription.id,
      planId,
      cycle,
      status: subscription.status,
      currentPeriodStart,
      currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
    });
  });
}

function stripeSecondsToDate(value: unknown): Date | null {
  return typeof value === 'number' && Number.isFinite(value) ? new Date(value * 1000) : null;
}

function isPaidPlanId(value: unknown): value is PaidPlanId {
  return value === 'pro' || value === 'studio';
}

function isBillingCycle(value: unknown): value is BillingCycle {
  return value === 'monthly' || value === 'yearly';
}
