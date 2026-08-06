import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSign } from 'node:crypto';
import { waffoService } from './waffo-service';
import { userRepo } from '@/db/repos/user-repo';
import { creditLedgerRepo } from '@/db/repos/credit-ledger-repo';
import { creditService } from '@/services/credit/credit-service';
import { isDbReachable, makeUser, cleanupUser } from '@/db/repos/__test__/setup';
import { ADDON_PACKS } from '@/config/pricing';
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

// The credits a pack-1 purchase grants — derived so it tracks re-denominations
// instead of silently going stale (mirrors creem-service.test.ts).
const PACK_1_CREDITS = ADDON_PACKS.find((p) => p.id === 'pack-1')!.books;

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

// ---- handleWebhook -------------------------------------------------------

function signWaffo(body: string, privateKey: string = TEST_KEYS.privateKey): string {
  const t = Date.now().toString();
  const v1 = createSign('RSA-SHA256').update(`${t}.${body}`).sign(privateKey, 'base64');
  return `t=${t},v1=${v1}`;
}

function useWebhookKey(t: { after(cb: () => void): void }): void {
  const prev = process.env.WAFFO_WEBHOOK_PUBLIC_KEY;
  process.env.WAFFO_WEBHOOK_PUBLIC_KEY = TEST_KEYS.publicKey; // SDK 解析顺序第 3 位,压过内置官方 key
  t.after(() => {
    if (prev === undefined) delete process.env.WAFFO_WEBHOOK_PUBLIC_KEY;
    else process.env.WAFFO_WEBHOOK_PUBLIC_KEY = prev;
  });
}

function waffoEvent(overrides: Record<string, unknown> = {}, dataOverrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    id: 'delivery-uuid-1',
    timestamp: new Date().toISOString(),
    eventType: 'order.completed',
    eventId: `PAY_${Math.random().toString(36).slice(2)}`,
    storeId: 'STO_test',
    storeName: 'Yujee',
    mode: 'test',
    data: {
      orderId: 'ORD_1',
      buyerEmail: 'buyer@yujee.test',
      currency: 'USD',
      amount: '3.00',
      taxAmount: '0.00',
      productName: 'Yujee Pack 1',
      orderMetadata: { userId: 'user_webhook_1', kind: 'pack', packId: 'pack-1' },
      ...dataOverrides,
    },
    ...overrides,
  });
}

test('waffo webhook: 缺签名头抛 WEBHOOK_SIGNATURE_INVALID', async (t) => {
  useWebhookKey(t);
  await assert.rejects(waffoService.handleWebhook(waffoEvent(), null), (e: any) => e.code === 'WEBHOOK_SIGNATURE_INVALID');
});

test('waffo webhook: 错误签名抛 WEBHOOK_SIGNATURE_INVALID', async (t) => {
  useWebhookKey(t);
  const wrongKeys = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const body = waffoEvent();
  await assert.rejects(
    waffoService.handleWebhook(body, signWaffo(body, wrongKeys.privateKey)),
    (e: any) => e.code === 'WEBHOOK_SIGNATURE_INVALID',
  );
});

test('waffo webhook: mode 与 WAFFO_ENV 不符则忽略不发积分', async (t) => {
  useWebhookKey(t);
  useEnvPatch(t, { WAFFO_ENV: 'test' });
  const applied: unknown[] = [];
  t.mock.method(creditService, 'applyDelta', (async (...a: unknown[]) => { applied.push(a); }) as any);
  t.mock.method(creditLedgerRepo, 'findByExternalEventId', async () => undefined);
  const body = waffoEvent({ mode: 'prod' });
  await waffoService.handleWebhook(body, signWaffo(body)); // 不抛(ack),但零发放
  assert.equal(applied.length, 0);
});

test('waffo webhook: 非 order.completed 忽略', async (t) => {
  useWebhookKey(t);
  const applied: unknown[] = [];
  t.mock.method(creditService, 'applyDelta', (async (...a: unknown[]) => { applied.push(a); }) as any);
  t.mock.method(creditLedgerRepo, 'findByExternalEventId', async () => undefined);
  const body = waffoEvent({ eventType: 'subscription.activated' });
  await waffoService.handleWebhook(body, signWaffo(body));
  assert.equal(applied.length, 0);
});

test('waffo webhook: metadata 不完整忽略', async (t) => {
  useWebhookKey(t);
  const applied: unknown[] = [];
  t.mock.method(creditService, 'applyDelta', (async (...a: unknown[]) => { applied.push(a); }) as any);
  t.mock.method(creditLedgerRepo, 'findByExternalEventId', async () => undefined);
  const body = waffoEvent({}, { orderMetadata: { kind: 'pack' } }); // 缺 userId/packId
  await waffoService.handleWebhook(body, signWaffo(body));
  assert.equal(applied.length, 0);
});

test('waffo webhook: order.completed 落账 + 重放幂等(需 DB)', async (t) => {
  if (!(await isDbReachable())) { t.skip('db unreachable'); return; }
  useWebhookKey(t);
  const user = await makeUser('waffo-webhook');
  try {
    const before = await creditService.getBalance(user.id);
    const body = waffoEvent({}, { orderMetadata: { userId: user.id, kind: 'pack', packId: 'pack-1' } });
    await waffoService.handleWebhook(body, signWaffo(body));
    assert.equal(await creditService.getBalance(user.id), before + PACK_1_CREDITS);
    await waffoService.handleWebhook(body, signWaffo(body)); // 同 eventId 重放
    assert.equal(await creditService.getBalance(user.id), before + PACK_1_CREDITS); // 不重复发
  } finally {
    await cleanupUser(user.id);
  }
});
