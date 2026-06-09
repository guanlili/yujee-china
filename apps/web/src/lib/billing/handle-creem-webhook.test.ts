import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handleCreemWebhook } from './handle-creem-webhook';
import { creemService } from '@/services/billing/creem-service';
import { ERRORS } from '@/lib/api/error-codes';

// Both Creem webhook routes must delegate to this one shared handler so the
// verification + crediting logic can never diverge between the canonical path
// and the /api/auth/creem/webhook compatibility path (#creem-webhook-path).
import { POST as canonicalPost } from '@/app/api/webhooks/creem/route';
import { POST as compatPost } from '@/app/api/auth/creem/webhook/route';

function webhookRequest(body: string, signature: string | null): Request {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (signature !== null) headers.set('creem-signature', signature);
  return new Request('https://app.test/webhook', { method: 'POST', headers, body });
}

test('both Creem webhook routes point at the shared handler', () => {
  assert.equal(canonicalPost, handleCreemWebhook, 'canonical route must reuse handleCreemWebhook');
  assert.equal(compatPost, handleCreemWebhook, 'compat /api/auth/creem/webhook route must reuse handleCreemWebhook');
});

test('handleCreemWebhook forwards raw body + creem-signature and returns 200', async (t) => {
  const calls: Array<{ rawBody: string; signature: string | null }> = [];
  t.mock.method(creemService, 'handleWebhook', async (rawBody: string, signature: string | null) => {
    calls.push({ rawBody, signature });
  });

  const body = JSON.stringify({ id: 'evt_x', eventType: 'checkout.completed' });
  const res = await handleCreemWebhook(webhookRequest(body, 'sig_abc'));

  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { received: true });
  assert.deepEqual(calls, [{ rawBody: body, signature: 'sig_abc' }]);
});

test('handleCreemWebhook passes a null signature through when header is absent', async (t) => {
  const calls: Array<{ signature: string | null }> = [];
  t.mock.method(creemService, 'handleWebhook', async (_rawBody: string, signature: string | null) => {
    calls.push({ signature });
  });

  await handleCreemWebhook(webhookRequest('{}', null));

  assert.deepEqual(calls, [{ signature: null }]);
});

test('handleCreemWebhook maps a thrown AppError to its status + code (no 200 on failure)', async (t) => {
  t.mock.method(creemService, 'handleWebhook', async () => {
    throw ERRORS.WEBHOOK_SIGNATURE_INVALID();
  });

  const res = await handleCreemWebhook(webhookRequest('{}', 'bad'));

  assert.equal(res.status, 400);
  const json = (await res.json()) as { ok: boolean; error: { code: string } };
  assert.equal(json.ok, false);
  assert.equal(json.error.code, 'WEBHOOK_SIGNATURE_INVALID');
});
