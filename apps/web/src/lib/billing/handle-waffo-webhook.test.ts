import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleWaffoWebhook } from './handle-waffo-webhook';
import { waffoService } from '@/services/billing/waffo-service';

test('handleWaffoWebhook: 透传 raw body 与 x-waffo-signature', async (t) => {
  const calls: Array<[string, string | null]> = [];
  t.mock.method(waffoService, 'handleWebhook', (async (body: string, sig: string | null) => {
    calls.push([body, sig]);
  }) as any);
  const res = await handleWaffoWebhook(new Request('https://x.test/api/webhooks/waffo', {
    method: 'POST',
    body: '{"raw":true}',
    headers: { 'x-waffo-signature': 't=1,v1=abc' },
  }));
  assert.equal(res.status, 200);
  assert.deepEqual(calls, [['{"raw":true}', 't=1,v1=abc']]);
});

test('handleWaffoWebhook: service 抛错转标准错误响应', async (t) => {
  t.mock.method(waffoService, 'handleWebhook', (async () => {
    const { ERRORS } = await import('@/lib/api/error-codes');
    throw ERRORS.WEBHOOK_SIGNATURE_INVALID();
  }) as any);
  const res = await handleWaffoWebhook(new Request('https://x.test/api/webhooks/waffo', { method: 'POST', body: '{}' }));
  assert.equal(res.status, 400);
});
