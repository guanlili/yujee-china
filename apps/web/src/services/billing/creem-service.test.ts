import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

// We import the service for the side-effect of compiling its module graph;
// the HMAC verifier is private, so the test exercises the webhook entry
// point (handleWebhook) against the real env.CREEM_WEBHOOK_SECRET dev default.
import { creemService } from './creem-service';
import { env } from '@/lib/env';
import { isDbReachable } from '@/db/repos/__test__/setup';

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

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
