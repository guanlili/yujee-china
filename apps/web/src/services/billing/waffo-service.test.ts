import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waffoService } from './waffo-service';
import { userRepo } from '@/db/repos/user-repo';
import { env } from '@/lib/env';

function useEnvPatch(t: { after(cb: () => void): void }, patch: Record<string, string | undefined>): void {
  const previous = new Map<string, unknown>();
  for (const [key, value] of Object.entries(patch)) {
    previous.set(key, (env as any)[key]);
    (env as any)[key] = value;
  }
  t.after(() => { for (const [k, v] of previous) (env as any)[k] = v; });
}

// 结构合法的临时 RSA 私钥——SDK 构造时校验 PEM 形状,签名真实性由 mock fetch 隔离。
import { generateKeyPairSync } from 'node:crypto';
const TEST_KEYS = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

// WaffoPancake 构造时用 validateShortId 校验 merchantId 必须匹配
// /^[A-Z]{2,5}_[0-9A-Za-z]{22}$/(实测自 @waffo/pancake-ts@0.17.0 dist/index.js:222,246-255)。
// 'MER_test123' 长度不够会在 `new WaffoPancake(...)` 时直接抛 WaffoPancakeError——
// 这里用满足格式的测试值,SDK 校验是权威,不改 SDK 行为。
function mockCheckoutDependencies(t: any) {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  useEnvPatch(t, {
    WAFFO_MERCHANT_ID: 'MER_test123456789012345678',
    WAFFO_PRIVATE_KEY: TEST_KEYS.privateKey,
    WAFFO_PRODUCT_ID_PACK_1: 'prod_waffo_pack_1',
    WEB_BASE_URL: 'https://app.yujee.test',
  });
  t.mock.method(userRepo, 'findById', async (userId: string) => ({ id: userId, email: 'buyer@yujee.test' }) as any);
  t.mock.method(globalThis, 'fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), init: init ?? {} });
    return new Response(JSON.stringify({
      data: { sessionId: 'ses_1', checkoutUrl: 'https://pay.waffo.ai/ses_1', expiresAt: '2026-08-06T00:45:00Z' },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch);
  return requests;
}

test('waffo createPackCheckout: 未配置时抛 BILLING_NOT_CONFIGURED 且不外呼', async (t) => {
  useEnvPatch(t, { WAFFO_MERCHANT_ID: undefined, WAFFO_PRIVATE_KEY: undefined });
  const calls: unknown[] = [];
  t.mock.method(globalThis, 'fetch', (async (...a: unknown[]) => { calls.push(a); throw new Error('unreachable'); }) as typeof fetch);
  await assert.rejects(waffoService.createPackCheckout('u1', 'pack-1'), (e: any) => e.code === 'BILLING_NOT_CONFIGURED');
  assert.equal(calls.length, 0);
});

test('waffo createPackCheckout: 请求携带 productId/buyerEmail/metadata/successUrl', async (t) => {
  const requests = mockCheckoutDependencies(t);
  const { url } = await waffoService.createPackCheckout('user_w_1', 'pack-1', { locale: 'zh', from: 'create' });
  assert.equal(url, 'https://pay.waffo.ai/ses_1');
  assert.equal(requests.length, 1);
  assert.ok(requests[0].url.startsWith('https://api.waffo.ai/'));
  const body = JSON.parse(String(requests[0].init.body));
  assert.equal(body.productId, 'prod_waffo_pack_1');
  assert.equal(body.buyerEmail, 'buyer@yujee.test');
  assert.equal(body.currency, 'USD');
  assert.deepEqual(body.metadata, { userId: 'user_w_1', kind: 'pack', packId: 'pack-1' });
  assert.equal(body.successUrl, 'https://app.yujee.test/zh/credits?checkout=success&provider=waffo&from=create');
});

test('waffo createPackCheckout: 未配置 product id 抛 BILLING_NOT_CONFIGURED', async (t) => {
  const requests = mockCheckoutDependencies(t);
  await assert.rejects(waffoService.createPackCheckout('u1', 'pack-4'), (e: any) => e.code === 'BILLING_NOT_CONFIGURED');
  assert.equal(requests.length, 0);
});

test('waffo createPackCheckout: 未知 pack 抛 VALIDATION_FAILED', async (t) => {
  mockCheckoutDependencies(t);
  await assert.rejects(waffoService.createPackCheckout('u1', 'pack-999'), (e: any) => e.code === 'VALIDATION_FAILED');
});
