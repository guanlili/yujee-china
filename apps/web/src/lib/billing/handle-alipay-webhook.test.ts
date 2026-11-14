import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleAlipayWebhook } from './handle-alipay-webhook';
import { alipayService } from '@/services/billing/alipay-service';

const BODY = 'out_trade_no=yj1&trade_status=TRADE_SUCCESS&trade_no=2026';

test('handleAlipayWebhook: 成功时回字面量 success', async (t) => {
  const calls: string[] = [];
  t.mock.method(alipayService, 'handleWebhook', (async (body: string) => {
    calls.push(body);
  }) as any);

  const res = await handleAlipayWebhook(
    new Request('https://x.test/api/webhooks/alipay', {
      method: 'POST',
      body: BODY,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    }),
  );

  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'success');
  assert.deepEqual(calls, [BODY], '必须原样透传 raw body,否则验签会因重新序列化失败');
});

test('handleAlipayWebhook: service 抛错时回 failure 且不泄露细节', async (t) => {
  t.mock.method(alipayService, 'handleWebhook', (async () => {
    throw new Error('signature boom');
  }) as any);

  const res = await handleAlipayWebhook(
    new Request('https://x.test/api/webhooks/alipay', { method: 'POST', body: BODY }),
  );

  assert.equal(res.status, 400);
  assert.equal(await res.text(), 'failure');
});
