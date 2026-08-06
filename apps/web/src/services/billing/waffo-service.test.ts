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
import { logger } from '@/lib/log/logger';

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

// per-env 公钥变量(WAFFO_WEBHOOK_TEST_PUBLIC_KEY / WAFFO_WEBHOOK_PROD_PUBLIC_KEY)在
// SDK 的解析链路里优先级高于下面设的共享 WAFFO_WEBHOOK_PUBLIC_KEY(dist/index.js
// resolveKeyForEnv:先查 per-env 变量,查不到才落到共享变量)。真实部署环境(本机
// .env.local / CI secret)完全可能残留这两个变量——不清空的话会悄悄压过本文件精心
// 构造的 TEST_KEYS,让签名验证在与本文件无关的地方失败(或更危险地,意外用一把不受
// 控的公钥通过验证)。见下面的回归探针测试。
//
// store 门(终审 Issue 1)改成 fail-closed 后,几乎每条 handleWebhook 用例都要显式
// 配好 WAFFO_ENV/WAFFO_STORE_ID 才能穿过门到达自己真正要测的分支——统一在这里 pin
// 默认值(与 waffoEvent() 的 mode:'test'/storeId:'STO_test' 对齐),个别用例需要不同
// 值时用 envOverrides 覆盖。
function useWebhookKey(
  t: { after(cb: () => void): void },
  envOverrides: Record<string, string | undefined> = {},
): void {
  const prev = process.env.WAFFO_WEBHOOK_PUBLIC_KEY;
  const prevTest = process.env.WAFFO_WEBHOOK_TEST_PUBLIC_KEY;
  const prevProd = process.env.WAFFO_WEBHOOK_PROD_PUBLIC_KEY;
  process.env.WAFFO_WEBHOOK_PUBLIC_KEY = TEST_KEYS.publicKey; // SDK 解析顺序第 5 位,压过内置官方 key
  delete process.env.WAFFO_WEBHOOK_TEST_PUBLIC_KEY;
  delete process.env.WAFFO_WEBHOOK_PROD_PUBLIC_KEY;
  t.after(() => {
    if (prev === undefined) delete process.env.WAFFO_WEBHOOK_PUBLIC_KEY;
    else process.env.WAFFO_WEBHOOK_PUBLIC_KEY = prev;
    if (prevTest === undefined) delete process.env.WAFFO_WEBHOOK_TEST_PUBLIC_KEY;
    else process.env.WAFFO_WEBHOOK_TEST_PUBLIC_KEY = prevTest;
    if (prevProd === undefined) delete process.env.WAFFO_WEBHOOK_PROD_PUBLIC_KEY;
    else process.env.WAFFO_WEBHOOK_PROD_PUBLIC_KEY = prevProd;
  });
  useEnvPatch(t, { WAFFO_ENV: 'test', WAFFO_STORE_ID: 'STO_test', ...envOverrides });
}

// 钉住某个 log 分支被真正命中(而不是"更早的 return 也满足了 applied.length===0")。
// logger 是纯对象方法,t.mock.method 可以直接替身,不需要额外的间接层。
function spyLog(t: { mock: { method(obj: unknown, key: string, impl: unknown): unknown } }, level: 'info' | 'warn' | 'error') {
  const calls: Array<{ payload: unknown; msg?: string }> = [];
  t.mock.method(logger, level, ((payload: unknown, msg?: string) => {
    calls.push({ payload, msg });
  }) as any);
  return calls;
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

// 回归探针(终审 Issue 3):模拟真实部署环境在 useWebhookKey 被调用*之前*就已经残留
// WAFFO_WEBHOOK_TEST_PUBLIC_KEY(比如 .env.local / CI secret)。若 useWebhookKey 不清
// 空它,resolveKeyForEnv 会优先用这把不相关的公钥去验本文件 TEST_KEYS 签的 payload,
// 直接验签失败——这不是本用例想测的东西,却会让签名相关的判断失真。
test('waffo webhook: useWebhookKey 清理测试环境残留的 per-env 公钥变量', async (t) => {
  const trueOriginalTestKey = process.env.WAFFO_WEBHOOK_TEST_PUBLIC_KEY;
  const pollutingKeys = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  process.env.WAFFO_WEBHOOK_TEST_PUBLIC_KEY = pollutingKeys.publicKey; // 模拟先于测试存在的残留
  useWebhookKey(t); // 应该在 setup 时清空它,并在测试结束后把它恢复成"清空前"的状态
  // 兜底:不管 useWebhookKey 内部 restore 到什么值,测试结束后都把这个合成的污染值
  // 冲掉,不让它漏到同一进程里跑的其它测试(t.after 按注册顺序执行,这个 hook 注册
  // 在 useWebhookKey 的 hook 之后,所以后运行,有最终决定权)。
  t.after(() => {
    if (trueOriginalTestKey === undefined) delete process.env.WAFFO_WEBHOOK_TEST_PUBLIC_KEY;
    else process.env.WAFFO_WEBHOOK_TEST_PUBLIC_KEY = trueOriginalTestKey;
  });
  // 命中幂等索引即早退,不必落库——这条测试只关心"验签本身有没有被污染的公钥搅黄"。
  t.mock.method(creditLedgerRepo, 'findByExternalEventId', async () => ({ id: 'existing' }) as any);
  const body = waffoEvent();
  await assert.doesNotReject(waffoService.handleWebhook(body, signWaffo(body)));
});

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
  useWebhookKey(t); // 默认已 pin WAFFO_ENV='test'(与下面 body 的 mode:'prod' 制造不符)
  const applied: unknown[] = [];
  t.mock.method(creditService, 'applyDelta', (async (...a: unknown[]) => { applied.push(a); }) as any);
  t.mock.method(creditLedgerRepo, 'findByExternalEventId', async () => undefined);
  const errorLogs = spyLog(t, 'error');
  const body = waffoEvent({ mode: 'prod' });
  await waffoService.handleWebhook(body, signWaffo(body)); // 不抛(ack),但零发放
  assert.equal(applied.length, 0);
  assert.equal(errorLogs.length, 1);
  assert.match(String(errorLogs[0].msg), /env mismatch/);
});

// store 门(终审 Issue 1)是 fail-closed 安全控制:未配置 WAFFO_STORE_ID 与配置了却不
// 匹配,都必须拒收——不是"配了才校验"的可选项(旧版 `env.WAFFO_STORE_ID && ...` 在漏
// 配时直接放行任何店的事件,等同于关掉这道门)。下面两条测试分别钉住这两个分支各自
// 独立的 error 日志文案,方便运维区分"忘配"和"配错"。
test('waffo webhook: 未配置 WAFFO_STORE_ID 则 fail-closed 拒收,不发积分', async (t) => {
  useWebhookKey(t, { WAFFO_STORE_ID: undefined });
  const applied: unknown[] = [];
  t.mock.method(creditService, 'applyDelta', (async (...a: unknown[]) => { applied.push(a); }) as any);
  t.mock.method(creditLedgerRepo, 'findByExternalEventId', async () => undefined);
  const errorLogs = spyLog(t, 'error');
  const body = waffoEvent();
  await waffoService.handleWebhook(body, signWaffo(body)); // 不抛(ack),但零发放
  assert.equal(applied.length, 0);
  assert.equal(errorLogs.length, 1);
  assert.match(String(errorLogs[0].msg), /not configured/);
});

test('waffo webhook: storeId 与配置的 WAFFO_STORE_ID 不符则忽略不发积分', async (t) => {
  useWebhookKey(t, { WAFFO_STORE_ID: 'STO_configured' });
  const applied: unknown[] = [];
  t.mock.method(creditService, 'applyDelta', (async (...a: unknown[]) => { applied.push(a); }) as any);
  t.mock.method(creditLedgerRepo, 'findByExternalEventId', async () => undefined);
  const errorLogs = spyLog(t, 'error');
  const body = waffoEvent({ storeId: 'STO_other' });
  await waffoService.handleWebhook(body, signWaffo(body)); // 不抛(ack),但零发放
  assert.equal(applied.length, 0);
  assert.equal(errorLogs.length, 1);
  assert.match(String(errorLogs[0].msg), /store mismatch/);
});

test('waffo webhook: 非 order.completed 忽略', async (t) => {
  useWebhookKey(t);
  const applied: unknown[] = [];
  t.mock.method(creditService, 'applyDelta', (async (...a: unknown[]) => { applied.push(a); }) as any);
  const findCalls: unknown[] = [];
  t.mock.method(creditLedgerRepo, 'findByExternalEventId', async (id: string) => {
    findCalls.push(id);
    return undefined;
  });
  const infoLogs = spyLog(t, 'info');
  const body = waffoEvent({ eventType: 'subscription.activated' });
  await waffoService.handleWebhook(body, signWaffo(body));
  assert.equal(applied.length, 0);
  // 终审 Issue 2:eventType 过滤挪到幂等查询之前——非 order.completed 事件不该产生
  // 一次多余的 DB 读。
  assert.equal(findCalls.length, 0, 'eventType 过滤应在幂等查询之前命中,不该走到 findByExternalEventId');
  assert.equal(infoLogs.length, 1);
  assert.match(String(infoLogs[0].msg), /waffo webhook ignored/);
});

test('waffo webhook: metadata 不完整忽略', async (t) => {
  useWebhookKey(t);
  const applied: unknown[] = [];
  t.mock.method(creditService, 'applyDelta', (async (...a: unknown[]) => { applied.push(a); }) as any);
  t.mock.method(creditLedgerRepo, 'findByExternalEventId', async () => undefined);
  const warnLogs = spyLog(t, 'warn');
  const body = waffoEvent({}, { orderMetadata: { kind: 'pack' } }); // 缺 userId/packId
  await waffoService.handleWebhook(body, signWaffo(body));
  assert.equal(applied.length, 0);
  assert.equal(warnLogs.length, 1);
  assert.match(String(warnLogs[0].msg), /waffo order metadata incomplete/);
});

// 终审 Issue 2:幂等键必须是 `waffo:${eventType}:${eventId}` 组合,不能只用 eventId。
// 依据:SDK 随包 docs/webhook-guide.md「Retry Mechanism」小节明确写"The same business
// event (same eventType + eventId) creates only one delivery record" —— 唯一性是
// eventType+eventId 的组合,eventId 单独不保证跨事件类型唯一(比如 refund 事件继承
// 订单侧 ID)。这里直接钉住传给 findByExternalEventId 的键的确切格式。
test('waffo webhook: 幂等键格式为 waffo:<eventType>:<eventId>', async (t) => {
  useWebhookKey(t);
  const findCalls: string[] = [];
  t.mock.method(creditLedgerRepo, 'findByExternalEventId', async (id: string) => {
    findCalls.push(id);
    return { id: 'existing-ledger-row' } as any; // 命中即早退,这条测试只关心键格式,不必落库
  });
  const applied: unknown[] = [];
  t.mock.method(creditService, 'applyDelta', (async (...a: unknown[]) => { applied.push(a); }) as any);
  const eventId = 'PAY_key_format_1';
  const body = waffoEvent({ eventId });
  await waffoService.handleWebhook(body, signWaffo(body));
  assert.deepEqual(findCalls, [`waffo:order.completed:${eventId}`]);
  assert.equal(applied.length, 0, '命中幂等索引应提前返回,不应落账');
});

// eventId 缺失时,幂等键会退化成 'waffo:undefined'(或 'waffo:')——第一单入账后,所有
// 后续事件(不管真实 eventId 是什么)都会被当成同一条重复记录静默吞掉。必须在算出
// 幂等键之前就拦住,不能让它流到 findByExternalEventId。
test('waffo webhook: eventId 为空则忽略不发积分(防幂等键退化)', async (t) => {
  useWebhookKey(t);
  const applied: unknown[] = [];
  t.mock.method(creditService, 'applyDelta', (async (...a: unknown[]) => { applied.push(a); }) as any);
  const findCalls: unknown[] = [];
  t.mock.method(creditLedgerRepo, 'findByExternalEventId', async (id: string) => {
    findCalls.push(id);
    return undefined;
  });
  const errorLogs = spyLog(t, 'error');
  const body = waffoEvent({ eventId: '' });
  await waffoService.handleWebhook(body, signWaffo(body));
  assert.equal(applied.length, 0);
  assert.equal(findCalls.length, 0, '不该拿退化的幂等键去查库');
  assert.equal(errorLogs.length, 1);
  assert.match(String(errorLogs[0].msg), /eventId/);
});

// 签名合法但验签后 payload 形状畸形(缺 data)时,后续的属性访问会直接抛 TypeError——
// 这不是签名问题,是 Waffo 那头发错了包。必须吞掉当 ack,否则 Waffo 对同一坏包无限重试。
test('waffo webhook: 验签后 payload 形状畸形(缺 data)不抛也不落账', async (t) => {
  useWebhookKey(t);
  const applied: unknown[] = [];
  t.mock.method(creditService, 'applyDelta', (async (...a: unknown[]) => { applied.push(a); }) as any);
  t.mock.method(creditLedgerRepo, 'findByExternalEventId', async () => undefined);
  const errorLogs = spyLog(t, 'error');
  const malformed = JSON.stringify({
    id: 'delivery-uuid-malformed',
    timestamp: new Date().toISOString(),
    eventType: 'order.completed',
    eventId: 'PAY_malformed_1',
    storeId: 'STO_test',
    storeName: 'Yujee',
    mode: 'test',
    // data 字段整个缺失——真实世界里可能是 Waffo 那头改版/发错包。
  });
  await assert.doesNotReject(waffoService.handleWebhook(malformed, signWaffo(malformed)));
  assert.equal(applied.length, 0);
  assert.equal(errorLogs.length, 1);
});

// 毒丸保护(上一条测试)绝不能变成"任何非 AppError 异常都 ack"。幂等查询是真实 DB
// 读,DB 瞬时故障(连接重置/超时/死锁)必须照常向上抛,让路由层变 500、Waffo 重试
// (幂等索引保证重试不会重复入账)。如果这里被误吞成 ack,真实付款的积分会永久丢失
// 且只留一行日志,没人知道要去查。
test('waffo webhook: 幂等查询抛基础设施错误(非 AppError)必须向上抛,不能 ack', async (t) => {
  useWebhookKey(t);
  const applied: unknown[] = [];
  t.mock.method(creditService, 'applyDelta', (async (...a: unknown[]) => { applied.push(a); }) as any);
  t.mock.method(creditLedgerRepo, 'findByExternalEventId', async () => {
    throw new Error('ECONNRESET: connection reset by peer');
  });
  const body = waffoEvent();
  await assert.rejects(waffoService.handleWebhook(body, signWaffo(body)), /ECONNRESET/);
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
