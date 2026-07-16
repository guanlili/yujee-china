import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

// We import the service for the side-effect of compiling its module graph;
// the HMAC verifier is private, so the test exercises the webhook entry
// point (handleWebhook) against the real env.CREEM_WEBHOOK_SECRET dev default.
import { creemService } from './creem-service';
import { db } from '@/db/client';
import { customerRepo } from '@/db/repos/customer-repo';
import { creditLedgerRepo } from '@/db/repos/credit-ledger-repo';
import { userRepo } from '@/db/repos/user-repo';
import { env } from '@/lib/env';
import { isDbReachable } from '@/db/repos/__test__/setup';
import { creditService } from '@/services/credit/credit-service';

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

function useEnvPatch(t: { after(callback: () => void): void }, patch: Record<string, string | undefined>): void {
  const previous = new Map<string, unknown>();
  for (const [key, value] of Object.entries(patch)) {
    previous.set(key, (env as any)[key]);
    (env as any)[key] = value;
  }
  t.after(() => {
    for (const [key, value] of previous.entries()) {
      (env as any)[key] = value;
    }
  });
}

function useWebhookSecret(t: { after(callback: () => void): void }, secret: string): void {
  const previous = env.CREEM_WEBHOOK_SECRET;
  (env as any).CREEM_WEBHOOK_SECRET = secret;
  t.after(() => {
    (env as any).CREEM_WEBHOOK_SECRET = previous;
  });
}

function mockCheckoutDependencies(t: any) {
  const requests: Array<{ url: string; init: RequestInit }> = [];

  useEnvPatch(t, {
    CREEM_API_KEY: 'creem-api-key-test',
    CREEM_API_BASE_URL: 'https://api.creem.test',
    WEB_BASE_URL: 'https://app.yujee.test',
    CREEM_PRODUCT_ID_PACK_1: 'prod_creem_pack_1',
  });

  t.mock.method(userRepo, 'findById', async (userId: string) => ({
    id: userId,
    email: 'buyer@yujee.test',
  }) as any);
  t.mock.method(customerRepo, 'findByUserAndProvider', async () => undefined);
  t.mock.method(globalThis, 'fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), init: init ?? {} });
    return new Response(JSON.stringify({
      id: 'checkout_123',
      checkout_url: 'https://checkout.creem.test/checkout_123',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch);

  return requests;
}

test('creemService.createPackCheckout: authenticates with x-api-key', async (t) => {
  const requests = mockCheckoutDependencies(t);

  await creemService.createPackCheckout('user_checkout_1', 'pack-1');

  const headers = new Headers(requests[0]?.init.headers);
  assert.equal(headers.get('x-api-key'), 'creem-api-key-test');
  assert.equal(headers.has('authorization'), false);
});

test('creemService.createPackCheckout: sends configured product id and keeps internal pack metadata', async (t) => {
  const requests = mockCheckoutDependencies(t);

  await creemService.createPackCheckout('user_checkout_2', 'pack-1');

  const body = JSON.parse(String(requests[0]?.init.body));
  assert.equal(body.product_id, 'prod_creem_pack_1');
  assert.deepEqual(body.metadata, {
    userId: 'user_checkout_2',
    kind: 'pack',
    packId: 'pack-1',
  });
});

test('creemService.createPackCheckout: sends Creem-supported success URL without cancel_url', async (t) => {
  const requests = mockCheckoutDependencies(t);

  await creemService.createPackCheckout('user_checkout_3', 'pack-1', {
    locale: 'zh',
    from: 'create',
  });

  const body = JSON.parse(String(requests[0]?.init.body));
  assert.equal(
    body.success_url,
    'https://app.yujee.test/zh/credits?checkout=success&provider=creem&from=create',
  );
  assert.equal('cancel_url' in body, false);
});

// Creem's docs list the base URL WITH /v1 (https://api.creem.io/v1), but our
// paths already include /v1. Setting the base the docs' way — or with a trailing
// slash — must not double the prefix into …/v1/v1/checkouts (a 404 that reads as
// a generic 500 to the buyer). The normalizer collapses all three forms.
for (const base of [
  'https://api.creem.io',
  'https://api.creem.io/',
  'https://api.creem.io/v1',
]) {
  test(`createPackCheckout: base "${base}" resolves to a single /v1/checkouts`, async (t) => {
    const requests = mockCheckoutDependencies(t);
    useEnvPatch(t, { CREEM_API_BASE_URL: base });

    await creemService.createPackCheckout('user_checkout_base', 'pack-1');

    assert.equal(requests[0]?.url, 'https://api.creem.io/v1/checkouts');
  });
}

test('createPackCheckout: surfaces Creem upstream status instead of a generic 500', async (t) => {
  mockCheckoutDependencies(t);
  // Override the happy-path fetch with a 401 (the shape of a test-vs-live key mismatch).
  t.mock.method(globalThis, 'fetch', (async () =>
    new Response('{"error":"unauthorized"}', { status: 401 })) as typeof fetch);

  await assert.rejects(
    creemService.createPackCheckout('user_checkout_401', 'pack-1'),
    (err: any) => {
      assert.equal(err.code, 'BILLING_UPSTREAM_ERROR');
      assert.equal(err.status, 502);
      assert.match(err.message, /401/);
      return true;
    },
  );
});

test('creemService: subscription checkout entry is removed (per-book billing #97)', () => {
  assert.equal(
    (creemService as Record<string, unknown>).createSubscriptionCheckout,
    undefined,
    'subscriptions are gone — only pack checkout remains',
  );
});

test('creemService.handleWebhook: rejects when signature missing', async () => {
  process.env.CREEM_WEBHOOK_SECRET = 'unit-test-secret';
  // Re-import not needed; env is parsed once. We rely on the dev default
  // being present; if not, this test must still error with WEBHOOK_NOT_CONFIGURED
  // before getting to the signature branch.
  await assert.rejects(
    () => creemService.handleWebhook('{}', null),
    (err: any) =>
      err.code === 'WEBHOOK_SIGNATURE_INVALID' || err.code === 'WEBHOOK_NOT_CONFIGURED',
  );
});

test('creemService.handleWebhook: rejects on bad signature', async () => {
  // env is parsed at process boot, so we read the resolved value here.
  // (CREEM_WEBHOOK_SECRET defaults to undefined; if it ever flips, the test
  // still exercises the signature-mismatch path for whatever value is set.)
  if (!env.CREEM_WEBHOOK_SECRET) {
    // Fall through to the WEBHOOK_NOT_CONFIGURED branch, which is also correct.
    await assert.rejects(
      () => creemService.handleWebhook('{}', 'deadbeef'),
      (err: any) =>
        err.code === 'WEBHOOK_NOT_CONFIGURED' || err.code === 'WEBHOOK_SIGNATURE_INVALID',
    );
    return;
  }
  const body = JSON.stringify({ id: 'evt_test_1', type: 'checkout.completed' });
  await assert.rejects(
    () => creemService.handleWebhook(body, 'deadbeef'),
    (err: any) => err.code === 'WEBHOOK_SIGNATURE_INVALID',
  );
});

test('creemService.handleWebhook: settles real checkout.completed eventType/object payload', async (t) => {
  const secret = 'unit-test-secret';
  useWebhookSecret(t, secret);

  const eventId = 'evt_5WHHcZPv7VS0YUsberIuOz';
  const userId = 'user_creem_checkout_completed';
  const body = JSON.stringify({
    id: eventId,
    eventType: 'checkout.completed',
    created_at: 1728734325927,
    object: {
      id: 'ch_4l0N34kxo16AhRKUHFUuXr',
      object: 'checkout',
      request_id: 'my-request-id',
      status: 'completed',
      order: {
        id: 'ord_4aDwWXjMLpes4Kj4XqNnUA',
        customer: 'cust_1OcIK1GEuVvXZwD19tjq2z',
        product: 'pack-1',
        amount: 300,
        currency: 'USD',
        status: 'paid',
      },
      customer: {
        id: 'cust_1OcIK1GEuVvXZwD19tjq2z',
        object: 'customer',
        email: 'customer@example.com',
      },
      metadata: {
        userId,
        kind: 'pack',
        packId: 'pack-1',
      },
      mode: 'test',
    },
  });
  const tx = { kind: 'mock-tx' };
  const createdCustomers: unknown[] = [];
  const appliedDeltas: unknown[] = [];

  t.mock.method(creditLedgerRepo, 'findByExternalEventId', async (actualEventId: string) => {
    assert.equal(actualEventId, eventId);
    return undefined;
  });
  t.mock.method(db, 'transaction', async (callback: (txArg: unknown) => Promise<unknown>) =>
    callback(tx),
  );
  t.mock.method(customerRepo, 'findByUserAndProvider', async (actualUserId: string, provider: string) => {
    assert.equal(actualUserId, userId);
    assert.equal(provider, 'creem');
    return undefined;
  });
  t.mock.method(customerRepo, 'create', async (txArg: unknown, data: unknown) => {
    assert.equal(txArg, tx);
    createdCustomers.push(data);
    return { id: 'customer-row', ...(data as Record<string, unknown>) };
  });
  t.mock.method(
    creditService,
    'applyDelta',
    async (
      txArg: unknown,
      actualUserId: string,
      delta: number,
      reason: string,
      refs: unknown,
    ) => {
      appliedDeltas.push({ txArg, userId: actualUserId, delta, reason, refs });
      return {} as any;
    },
  );

  await creemService.handleWebhook(body, sign(body, secret));

  assert.deepEqual(createdCustomers, [
    {
      userId,
      provider: 'creem',
      externalCustomerId: 'cust_1OcIK1GEuVvXZwD19tjq2z',
      email: 'customer@example.com',
    },
  ]);
  assert.deepEqual(appliedDeltas, [
    {
      txArg: tx,
      userId,
      delta: 1,
      reason: 'PURCHASE',
      refs: {
        externalEventId: eventId,
        meta: {
          provider: 'creem',
          session_id: 'ch_4l0N34kxo16AhRKUHFUuXr',
          pack_id: 'pack-1',
          amount_cents: 300,
        },
      },
    },
  ]);
});

test('creemService.handleWebhook: ignores legacy subscription-kind checkout without crediting (per-book billing #97)', async (t) => {
  const secret = 'unit-test-secret';
  useWebhookSecret(t, secret);

  const eventId = 'evt_subscription_ignored';
  const body = JSON.stringify({
    id: eventId,
    eventType: 'checkout.completed',
    created_at: '2026-06-04T10:30:15.000Z',
    object: {
      id: 'ch_subscription_123',
      status: 'completed',
      customer: { id: 'cust_subscription_123', email: 'subscriber@example.com' },
      metadata: {
        userId: 'user_legacy_subscription',
        kind: 'subscription',
        planId: 'pro',
        cycle: 'monthly',
      },
    },
  });
  const appliedDeltas: unknown[] = [];

  t.mock.method(creditLedgerRepo, 'findByExternalEventId', async () => undefined);
  t.mock.method(db, 'transaction', async (callback: (txArg: unknown) => Promise<unknown>) =>
    callback({ kind: 'mock-tx' }),
  );
  t.mock.method(creditService, 'applyDelta', async (..._args: unknown[]) => {
    appliedDeltas.push(_args);
    return {} as any;
  });

  // A subscription-kind payload has no pack id, so it falls through the "metadata
  // incomplete" guard and is ignored — no balance change.
  await creemService.handleWebhook(body, sign(body, secret));

  assert.equal(appliedDeltas.length, 0, 'subscription payloads must not credit any books');
});

test('creemService.handleWebhook: accepts valid signature + ignores unknown event', async (t) => {
  if (!env.CREEM_WEBHOOK_SECRET) {
    t.skip('CREEM_WEBHOOK_SECRET not set in env — set it to exercise the happy path');
    return;
  }
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL not reachable — handleWebhook needs DB for idempotency probe');
    return;
  }
  const body = JSON.stringify({
    id: `evt_${Date.now()}`,
    type: 'customer.something_we_dont_care_about',
    data: { object: { id: 'co_xxx' } },
  });
  const sig = sign(body, env.CREEM_WEBHOOK_SECRET);
  await creemService.handleWebhook(body, sig);
  // Expected: no throw, no credit changes (just ignored).
});
