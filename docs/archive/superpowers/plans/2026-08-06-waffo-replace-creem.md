# Waffo 替换 Creem 实施计划（Phase 1）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Yujee 的积分包购买主通道从 Creem 切到 Waffo Pancake（`@waffo/pancake-ts`），Creem webhook 留作在途订单兜底。

**Architecture:** 新建 `waffo-service.ts` 对齐 `creem-service.ts` 的接口形状（`createPackCheckout` + `handleWebhook`），checkout 路由按 `ACTIVE_CHECKOUT_PROVIDER` 分发，新增 `/api/webhooks/waffo` 端点。积分发放复用 `creditService.applyDelta` + `credit_ledger` 幂等索引，**零 DB 改动**（Waffo 无 customer id 概念，不写 customers 表——这是对 spec 的已核实简化）。

**Tech Stack:** Next.js 15 App Router / `@waffo/pancake-ts@0.17.0`（零运行时依赖、无 install 钩子，已审）/ node:test + tsx / Drizzle（本次不动 schema）。

## Global Constraints

- 工作目录：worktree `/Users/smalldog/Desktop/yujee工程文件/memoir-waffo-worktree`，分支 `feat/waffo-payments`。
- 测试命令：`pnpm --filter @yujee/web test`（仓根 `pnpm test` 撞到首个失败包就中断，别用）。单文件：`cd apps/web && pnpm exec tsx --test src/services/billing/waffo-service.test.ts`。
- 类型检查：仓根 `pnpm typecheck`（含 `docs:check`，改了 `apps/web/src/app/api/**` / `services/**` / `lib/env.ts` 必须推进相关 README 的 `checked-at`，见 Task 8）。
- 缺 `apps/web/.env.local` 时 DB 集成测试假跳过——落账/幂等测试要有 DB 才真跑。
- 不改三个购买入口组件、不改 `creditService`、不删任何 Creem 代码（Phase 2 另做）。
- SDK 事实（已从 0.17.0 dist 核实，不要按官网博客写）：
  - `new WaffoPancake({ merchantId, privateKey })`；`client.checkout.createSession(params)` → `{ sessionId, checkoutUrl, expiresAt }`。
  - `CreateCheckoutSessionParams` 无 `productType` 字段（产品类型由 productId 决定）；`metadata: Record<string, string>`。
  - `verifyWebhook(payload, signatureHeader, options?)`：**失败一律 throw**；签名头 `t=<ms>,v1=<base64 RSA-SHA256>`，签名输入 `` `${t}.${payload}` ``；公钥解析顺序 per-call `publicKey` → config → 环境变量 `WAFFO_WEBHOOK_{TEST|PROD}_PUBLIC_KEY` / `WAFFO_WEBHOOK_PUBLIC_KEY` → SDK 内置官方公钥。
  - `WebhookEvent`：`eventId`（业务 ID，幂等用）、`eventType`（要 `'order.completed'`）、`mode: 'test'|'prod'`、`storeId`、`data.orderMetadata?: Record<string,string>`（checkout metadata 回传处）、`data.amount: string`（如 `"3.00"`）、`data.orderId`、`data.buyerEmail`。
  - API 响应信封 `{ data: T | null, errors?: Notice[] }`；mock fetch 返回 `{ data: {...} }`。若 SDK 解包行为与预期不符，读 `apps/web/node_modules/@waffo/pancake-ts/docs/api-reference.md`（随包分发）定案。

---

### Task 1: 安装 SDK 并扩展 pricing 的 provider 定义

**Files:**
- Modify: `apps/web/package.json`（pnpm add）
- Modify: `apps/web/src/config/pricing.ts:31-44`、`:114-118`
- Test: `apps/web/src/config/pricing.test.ts`

**Interfaces:**
- Produces: `CheckoutProvider` 联合加 `'waffo'`；`ACTIVE_CHECKOUT_PROVIDER = 'waffo'`；`WaffoProductEnvKey`；`WAFFO_PRODUCT_ENV_BY_PACK_ID: Record<AddonPackId, WaffoProductEnvKey>`。后续任务按这些确切名字 import。

- [ ] **Step 1: 安装锁定版本**

```bash
cd apps/web && pnpm add @waffo/pancake-ts@0.17.0 --save-exact
```

- [ ] **Step 2: 写失败测试**（追加到 `pricing.test.ts`，沿用该文件现有 node:test 风格）

```ts
import { ACTIVE_CHECKOUT_PROVIDER, CHECKOUT_PROVIDERS, WAFFO_PRODUCT_ENV_BY_PACK_ID, ADDON_PACKS, buildCheckoutReturnUrls } from './pricing';

test('waffo is the active checkout provider', () => {
  assert.equal(ACTIVE_CHECKOUT_PROVIDER, 'waffo');
  assert.ok(CHECKOUT_PROVIDERS.includes('waffo'));
  assert.ok(CHECKOUT_PROVIDERS.includes('creem')); // Phase 1 保留
});

test('every pack has a waffo product env key', () => {
  for (const pack of ADDON_PACKS) {
    assert.match(WAFFO_PRODUCT_ENV_BY_PACK_ID[pack.id], /^WAFFO_PRODUCT_ID_PACK_/);
  }
});

test('buildCheckoutReturnUrls carries provider=waffo', () => {
  const { successUrl } = buildCheckoutReturnUrls('https://app.yujee.test', 'waffo', { locale: 'zh', from: 'create' });
  assert.equal(successUrl, 'https://app.yujee.test/zh/credits?checkout=success&provider=waffo&from=create');
});
```

- [ ] **Step 3: 跑测试确认失败**：`cd apps/web && pnpm exec tsx --test src/config/pricing.test.ts` → FAIL（`'waffo'` 不在联合类型/常量里）
- [ ] **Step 4: 最小实现**（pricing.ts）

```ts
export type CheckoutProvider = 'creem' | 'waffo';
export const CHECKOUT_PROVIDERS = ['creem', 'waffo'] as const satisfies readonly CheckoutProvider[];
// Waffo 是主通道(2026-08 切换);creem 保留仅为 Phase 1 在途订单 webhook 兜底。
export const ACTIVE_CHECKOUT_PROVIDER = 'waffo' satisfies CheckoutProvider;

export type WaffoProductEnvKey =
  | 'WAFFO_PRODUCT_ID_PACK_1'
  | 'WAFFO_PRODUCT_ID_PACK_4'
  | 'WAFFO_PRODUCT_ID_PACK_10';

export const WAFFO_PRODUCT_ENV_BY_PACK_ID: Record<AddonPackId, WaffoProductEnvKey> = {
  'pack-1': 'WAFFO_PRODUCT_ID_PACK_1',
  'pack-4': 'WAFFO_PRODUCT_ID_PACK_4',
  'pack-10': 'WAFFO_PRODUCT_ID_PACK_10',
};
```

（`ADDON_PACKS` 上方注释里的「Creem 产品 id 走 env」改成「产品 id 走 env(主通道 Waffo,Creem 兜底)」。）

- [ ] **Step 5: 跑测试确认通过**；注意 checkout 路由此刻仍 hardcode 走 creemService，不受 ACTIVE 切换影响（Task 5 才切），全量 `pnpm --filter @yujee/web test` 应保持绿。
- [ ] **Step 6: Commit**：`git add -A && git commit -m "feat(web): pricing 支持 waffo provider + 锁定 @waffo/pancake-ts"`

---

### Task 2: env 扩展 WAFFO_* 变量

**Files:**
- Modify: `apps/web/src/lib/env.ts:56-62`（Creem 块后追加）
- Modify: `/.env.example:35-40` 附近
- Test: 无独立测试（zod schema 由后续 service 测试覆盖）；跑 `pnpm --filter @yujee/web test` 保绿即可

**Interfaces:**
- Produces: `env.WAFFO_MERCHANT_ID?` / `env.WAFFO_STORE_ID?` / `env.WAFFO_PRIVATE_KEY?` / `env.WAFFO_ENV: 'test'|'prod'`（默认 `'test'`）/ `env.WAFFO_PRODUCT_ID_PACK_1/_4/_10?`

- [ ] **Step 1: env.ts 追加**（放在 Creem 块之后，保持分组注释风格）

```ts
  // Payment · Waffo Pancake (海外主通道,2026-08 起替换 Creem;Creem 变量留作在途订单兜底)
  // WAFFO_ENV 决定 webhook 验签用哪把官方公钥 + 拒收错环境事件。
  // 生产必须显式设 'prod',否则 live 事件会被当错环境静默忽略(只扣钱不发积分)。
  WAFFO_MERCHANT_ID: z.string().optional(),
  WAFFO_STORE_ID: z.string().optional(),
  WAFFO_PRIVATE_KEY: z.string().optional(),
  WAFFO_ENV: z.enum(['test', 'prod']).default('test'),
  WAFFO_PRODUCT_ID_PACK_1: z.string().optional(),
  WAFFO_PRODUCT_ID_PACK_4: z.string().optional(),
  WAFFO_PRODUCT_ID_PACK_10: z.string().optional(),
```

- [ ] **Step 2: .env.example 追加**（Creem 段之后）

```bash
# Payment · Waffo Pancake(海外主通道,替换 Creem;私钥 PEM 转义换行或 base64 均可,SDK 自归一)
# 生产必须 WAFFO_ENV=prod。webhook 公钥 SDK 内置,无需配置。
WAFFO_MERCHANT_ID=
WAFFO_STORE_ID=
WAFFO_PRIVATE_KEY=
WAFFO_ENV=test
WAFFO_PRODUCT_ID_PACK_1=
WAFFO_PRODUCT_ID_PACK_4=
WAFFO_PRODUCT_ID_PACK_10=
```

- [ ] **Step 3: 跑 `pnpm --filter @yujee/web test` 保绿**（`stripe-removal.test.ts` 只断言 STRIPE_*，WAFFO_* 不冲突）
- [ ] **Step 4: Commit**：`git commit -am "feat(web): env 增加 WAFFO_* 配置"`

---

### Task 3: waffo-service.createPackCheckout（TDD）

**Files:**
- Create: `apps/web/src/services/billing/waffo-service.ts`
- Test: `apps/web/src/services/billing/waffo-service.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `WAFFO_PRODUCT_ENV_BY_PACK_ID`、`buildCheckoutReturnUrls`；Task 2 的 `env.WAFFO_*`。
- Produces: `waffoService.createPackCheckout(userId: string, packId: string, context?: CheckoutReturnContext): Promise<{ url: string }>`（签名与 creemService 完全一致，Task 5 依赖）。

- [ ] **Step 1: 写失败测试**（新文件，头部工具函数照抄 creem-service.test.ts 的 `useEnvPatch` 模式）

```ts
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

function mockCheckoutDependencies(t: any) {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  useEnvPatch(t, {
    WAFFO_MERCHANT_ID: 'MER_test123',
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
```

注：若 SDK 请求体字段名与断言不符（camel/snake），以跑测时捕获的真实请求为准修断言——SDK 是权威，不改 SDK 行为。

- [ ] **Step 2: 跑测试确认失败**：`cd apps/web && pnpm exec tsx --test src/services/billing/waffo-service.test.ts` → FAIL（模块不存在）
- [ ] **Step 3: 最小实现**（waffo-service.ts；只含 createPackCheckout，handleWebhook 留 Task 4）

```ts
import { WaffoPancake } from '@waffo/pancake-ts';
import { userRepo } from '@/db/repos/user-repo';
import {
  ADDON_PACKS,
  WAFFO_PRODUCT_ENV_BY_PACK_ID,
  buildCheckoutReturnUrls,
  type CheckoutReturnContext,
  type AddonPackId,
} from '@/config/pricing';
import { env } from '@/lib/env';
import { AppError, ERRORS } from '@/lib/api/error-codes';
import { logger } from '@/lib/log/logger';

// Waffo Pancake — 海外主通道 MoR(2026-08 替换 Creem)。沿用 applyDelta +
// external_event_id 幂等契约。与 Creem 的关键差异:Waffo 无 customer id 概念
// (checkout/webhook 都只有 buyerEmail),因此不读写 customers 表。

function getClient(): WaffoPancake {
  if (!env.WAFFO_MERCHANT_ID || !env.WAFFO_PRIVATE_KEY) throw ERRORS.BILLING_NOT_CONFIGURED();
  return new WaffoPancake({ merchantId: env.WAFFO_MERCHANT_ID, privateKey: env.WAFFO_PRIVATE_KEY });
}

function resolveWaffoProductId(packId: AddonPackId): string {
  const envKey = WAFFO_PRODUCT_ENV_BY_PACK_ID[packId];
  const productId = env[envKey];
  if (!productId) {
    logger.warn({ packId, envKey }, 'waffo product id missing');
    throw ERRORS.BILLING_NOT_CONFIGURED();
  }
  return productId;
}

export const waffoService = {
  async createPackCheckout(
    userId: string,
    packId: string,
    context: CheckoutReturnContext = {},
  ): Promise<{ url: string }> {
    const pack = ADDON_PACKS.find((p) => p.id === packId);
    if (!pack) throw ERRORS.VALIDATION_FAILED(`Unknown pack: ${packId}`);
    const client = getClient();
    const productId = resolveWaffoProductId(pack.id);
    const user = await userRepo.findById(userId);
    if (!user) throw ERRORS.UNAUTHORIZED();

    const { successUrl } = buildCheckoutReturnUrls(env.WEB_BASE_URL, 'waffo', context);
    let session: { checkoutUrl: string };
    try {
      session = await client.checkout.createSession({
        productId,
        currency: 'USD',
        buyerEmail: user.email,
        successUrl,
        metadata: { userId, kind: 'pack', packId },
      });
    } catch (e) {
      if (e instanceof AppError) throw e;
      logger.warn({ err: String(e), packId }, 'waffo api error');
      throw ERRORS.BILLING_UPSTREAM_ERROR(502);
    }
    if (!session.checkoutUrl) throw ERRORS.INTERNAL_ERROR();
    return { url: session.checkoutUrl };
  },
};
```

- [ ] **Step 4: 跑测试确认通过**（同 Step 2 命令 → PASS）
- [ ] **Step 5: Commit**：`git add -A && git commit -m "feat(web): waffo-service checkout 创建"`

---

### Task 4: waffo-service.handleWebhook（TDD，含 RSA 验签与幂等）

**Files:**
- Modify: `apps/web/src/services/billing/waffo-service.ts`
- Test: `apps/web/src/services/billing/waffo-service.test.ts`（追加）

**Interfaces:**
- Consumes: `verifyWebhook` from `@waffo/pancake-ts`；`creditService.applyDelta`、`creditLedgerRepo.findByExternalEventId`（与 creem-service 相同用法）。
- Produces: `waffoService.handleWebhook(rawBody: string, signature: string | null): Promise<void>`（Task 5 的路由 handler 依赖）。幂等键格式 `` `waffo:${event.eventId}` ``。

- [ ] **Step 1: 写失败测试**（追加；签名工具 + 事件工厂）

```ts
import { createSign } from 'node:crypto';
import { db } from '@/db/client';
import { creditLedgerRepo } from '@/db/repos/credit-ledger-repo';
import { creditService } from '@/services/credit/credit-service';
import { isDbReachable } from '@/db/repos/__test__/setup';
import { ADDON_PACKS } from '@/config/pricing';

const PACK_1_CREDITS = ADDON_PACKS.find((p) => p.id === 'pack-1')!.books;

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
  const user = await userRepo.create({ email: `waffo-e2e-${Date.now()}@yujee.test` } as any);
  const before = await creditService.getBalance(user.id);
  const body = waffoEvent({}, { orderMetadata: { userId: user.id, kind: 'pack', packId: 'pack-1' } });
  await waffoService.handleWebhook(body, signWaffo(body));
  assert.equal(await creditService.getBalance(user.id), before + PACK_1_CREDITS);
  await waffoService.handleWebhook(body, signWaffo(body)); // 同 eventId 重放
  assert.equal(await creditService.getBalance(user.id), before + PACK_1_CREDITS); // 不重复发
});
```

注 1：落账测试里 `userRepo.create` 的确切签名以 `user-repo.ts` 为准（creem 落账测试同文件有现成建用户写法，照抄它的）。
注 2：`signWaffo` 用 `Date.now()`（真实时间），在 verifyWebhook 默认 5 分钟容差内。

- [ ] **Step 2: 跑测试确认失败**（handleWebhook 未定义）
- [ ] **Step 3: 实现**（追加到 waffo-service.ts；import 加 `verifyWebhook, type WebhookEvent, type WebhookEventData`，crypto 不需要）

```ts
  async handleWebhook(rawBody: string, signature: string | null): Promise<void> {
    let event: WebhookEvent<WebhookEventData>;
    try {
      event = verifyWebhook<WebhookEventData>(rawBody, signature, { environment: env.WAFFO_ENV });
    } catch (e) {
      logger.warn({ err: String(e) }, 'waffo webhook signature failed');
      throw ERRORS.WEBHOOK_SIGNATURE_INVALID();
    }

    // 环境隔离:test 事件打到 prod(或反向)必须拒发积分。签名层通常已按环境公钥
    // 拦住,这里是密钥配置错误时的兜底。ack(不抛)以免 Waffo 无限重试。
    if (event.mode !== env.WAFFO_ENV) {
      logger.error({ eventMode: event.mode, expected: env.WAFFO_ENV, eventId: event.eventId }, 'waffo webhook env mismatch, ignored');
      return;
    }
    if (env.WAFFO_STORE_ID && event.storeId !== env.WAFFO_STORE_ID) {
      logger.error({ storeId: event.storeId, eventId: event.eventId }, 'waffo webhook store mismatch, ignored');
      return;
    }

    const externalEventId = `waffo:${event.eventId}`;
    const existing = await creditLedgerRepo.findByExternalEventId(externalEventId);
    if (existing) {
      logger.info({ eventId: event.eventId, type: event.eventType }, 'waffo webhook duplicate, skipped');
      return;
    }

    if (event.eventType !== 'order.completed') {
      logger.info({ type: event.eventType, eventId: event.eventId }, 'waffo webhook ignored');
      return;
    }

    const meta = event.data.orderMetadata ?? {};
    const userId = meta.userId;
    const packId = meta.packId;
    if (!userId || meta.kind !== 'pack' || !packId) {
      logger.warn({ eventId: event.eventId }, 'waffo order metadata incomplete');
      return;
    }
    const pack = ADDON_PACKS.find((p) => p.id === packId);
    if (!pack) {
      logger.warn({ eventId: event.eventId, packId }, 'waffo pack unknown');
      return;
    }

    const amountCents = Number.isFinite(Number(event.data.amount))
      ? Math.round(Number(event.data.amount) * 100)
      : Math.round(pack.priceUsd * 100);

    await db.transaction(async (tx) => {
      await creditService.applyDelta(tx, userId, pack.books, 'PURCHASE', {
        externalEventId,
        meta: {
          provider: 'waffo',
          order_id: event.data.orderId ?? null,
          pack_id: pack.id,
          amount_cents: amountCents,
        },
      });
    });

    logger.info({ userId, packId, books: pack.books, eventId: event.eventId }, 'waffo purchase credited');
  },
```

（同时 import `db`、`creditLedgerRepo`、`creditService`——对照 creem-service.ts 第 2-6 行。）

- [ ] **Step 4: 跑测试确认通过**；并跑 `pnpm --filter @yujee/web test` 全量保绿
- [ ] **Step 5: Commit**：`git commit -am "feat(web): waffo webhook 验签+幂等落账"`

---

### Task 5: webhook 路由挂载 + checkout 路由切换到 Waffo

**Files:**
- Create: `apps/web/src/lib/billing/handle-waffo-webhook.ts`
- Create: `apps/web/src/app/api/webhooks/waffo/route.ts`
- Modify: `apps/web/src/app/api/v1/billing/checkout/route.ts:6,21`
- Test: `apps/web/src/lib/billing/handle-waffo-webhook.test.ts`

**Interfaces:**
- Consumes: Task 3/4 的 `waffoService`；Task 1 的 `ACTIVE_CHECKOUT_PROVIDER`。
- Produces: `handleWaffoWebhook(req: Request): Promise<Response>`；POST `/api/webhooks/waffo`。

- [ ] **Step 1: 写失败测试**（对照 handle-creem-webhook.test.ts 的形状）

```ts
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
```

- [ ] **Step 2: 跑测试确认失败**
- [ ] **Step 3: 实现三个文件**

`handle-waffo-webhook.ts`：

```ts
import { waffoService } from '@/services/billing/waffo-service';
import { fromException } from '@/lib/api/from-exception';

// Waffo webhook 入口。单一挂载(/api/webhooks/waffo);与 creem 不同,Waffo 的
// 投递地址在其 dashboard 配置一次,没有历史双路径包袱。
export async function handleWaffoWebhook(req: Request): Promise<Response> {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get('x-waffo-signature');
    await waffoService.handleWebhook(rawBody, signature);
    return Response.json({ received: true });
  } catch (e) {
    return fromException(e);
  }
}
```

`app/api/webhooks/waffo/route.ts`（对照 creem 同位置文件的 5 行形状）：

```ts
import { handleWaffoWebhook } from '@/lib/billing/handle-waffo-webhook';

export const runtime = 'nodejs';
export const POST = handleWaffoWebhook;
```

`checkout/route.ts` 改动（第 6 行 import 区、第 21 行调用处）：

```ts
import { creemService } from '@/services/billing/creem-service';
import { waffoService } from '@/services/billing/waffo-service';
import { ACTIVE_CHECKOUT_PROVIDER } from '@/config/pricing';

// createPackCheckout 双实现签名一致;按 ACTIVE_CHECKOUT_PROVIDER 单点切换。
const checkoutService = ACTIVE_CHECKOUT_PROVIDER === 'waffo' ? waffoService : creemService;
```

调用处 `creemService.createPackCheckout(...)` → `checkoutService.createPackCheckout(...)`。

- [ ] **Step 4: 跑测试确认通过** + `pnpm --filter @yujee/web test` 全量绿（creem 测试直接调 creemService，不受切换影响）
- [ ] **Step 5: Commit**：`git commit -am "feat(web): waffo webhook 路由 + checkout 主通道切到 waffo"`

---

### Task 6: admin settings 显示 Waffo 开关状态

**Files:**
- Modify: `apps/web/src/app/[locale]/admin/settings/page.tsx:21`

- [ ] **Step 1: 修改 providers 数组**（该页是服务端只读展示，无既有测试，不新增）

```ts
const providers = [
  { name: 'Waffo', on: Boolean(env.WAFFO_MERCHANT_ID) },
  { name: 'Creem(兜底)', on: Boolean(env.CREEM_API_KEY) },
];
```

（以该文件真实结构为准——若是单对象而非数组，保持其现有渲染方式追加一行。）

- [ ] **Step 2: `pnpm --filter @yujee/web test` 保绿 + Commit**：`git commit -am "feat(web): admin settings 显示 waffo 状态"`

---

### Task 7: 文档同步 + doc-scope checked-at + 全量验证

**Files:**
- Modify: `apps/web/README.md`（第 3、9、212-214、254 行附近的 Creem 表述 + 尾部 checked-at）
- Modify: `/README.md`、`/CLAUDE.md`（尾部 checked-at；正文若提及 Creem 支付则同步）
- Modify: `docs/superpowers/specs/2026-08-06-waffo-replace-creem-design.md`（记录「无 DB 迁移」的已核实偏差）

- [ ] **Step 1: 更新 apps/web/README.md**：billing 表述改为「主通道 Waffo(@waffo/pancake-ts,RSA 验签),Creem webhook 留作 Phase 1 在途兜底」；env 表格加 `WAFFO_*` | Billing 行。
- [ ] **Step 2: spec 补记**：开放问题两条的结论（orderMetadata 回传✓、公钥 SDK 内置✓）+「Waffo 无 customer id → 取消 0025 迁移」。
- [ ] **Step 3: 跑 `git log --oneline -1` 拿当前提交,把三份文档尾部 `checked-at` 更新为该提交**（机制见 CLAUDE.md 文档时效规则；本步骤后再 commit,checked-at 允许指向上一提交——`docs:check` 校验的是覆盖路径无更新的提交,最终以 `pnpm docs:check` 绿为准,红了就按报错把 checked-at 推到位）。
- [ ] **Step 4: 全量验证**

```bash
pnpm typecheck        # 含 docs:check + web typecheck
pnpm --filter @yujee/web test
```

两者必须全绿；红了修到绿，不许跳过。
- [ ] **Step 5: Commit**：`git add -A && git commit -m "docs: billing 文档切换到 waffo + checked-at 推进"`

---

### Task 8: 本地 E2E 验证（需用户提供 test 私钥后执行）

**前置（用户操作）**：把 Waffo test 凭证写入 `apps/web/.env.local`：
`WAFFO_MERCHANT_ID=MER_122otSZjjx0Bd57cmRVJMB` / `WAFFO_STORE_ID=STO_0bzVeZxrGwpVTvMsfJaza2` / `WAFFO_PRIVATE_KEY=<私钥>` / `WAFFO_ENV=test` / 三个 `WAFFO_PRODUCT_ID_PACK_*`（先在 Waffo 后台建好 test 产品，或用一次性脚本 `client.onetimeProducts.create` 建，产品价格对齐 $3/$10/$20）。

- [ ] **Step 1**: worktree 起三服务（web:3000 / agent:8001 / design-agent:8787），先确认 :3000 是本 worktree 的 dev server（多 worktree 陷阱）。
- [ ] **Step 2**: 测试账号登录 → credits 页买 pack-1 → 跳 Waffo 收银台 → 测试卡 `4576750000000110` 支付。
- [ ] **Step 3**: webhook 本地接收：Waffo dashboard 把 test webhook URL 指向隧道（`cloudflared tunnel --url http://localhost:3000` 或等价物）→ 确认 `/api/webhooks/waffo` 收到 `order.completed`、积分 +20、credits 页轮询显示到账。
- [ ] **Step 4**: 重放同一事件（dashboard 重发）确认幂等：余额不再增加、日志出现 `duplicate, skipped`。
- [ ] **Step 5**: 记录验证结果（截图/日志摘录）供评审。

---

## 上线清单（合并后，用户操作为主）

1. Waffo 正式商户开通（KYC 如有）→ live 私钥。
2. 后台建 3 个 live 产品并 publish（$3/20、$10/80、$20/200，taxCategory 按 Waffo 后台对 SaaS/数字商品的分类选择）。
3. Vercel 生产环境变量：`WAFFO_MERCHANT_ID / WAFFO_STORE_ID / WAFFO_PRIVATE_KEY / WAFFO_ENV=prod / WAFFO_PRODUCT_ID_PACK_1/_4/_10`。**`WAFFO_ENV=prod` 必须设**（默认 test 会导致 verifyWebhook 拿 test 公钥验 prod 签名，直接签名失败返回 400，而非静默忽略——见下条重试机制）。
4. Waffo dashboard 配 prod webhook：`https://yujeeai.com/api/webhooks/waffo`。
5. 上线后真实小额买一单 pack-1 验证全链路，验证要验到**积分到账**（credits 页余额真的加了），不是只看到跳转成功页——跳转成功不代表 webhook 已经处理完。然后申请退款验证（退款事件 Phase 1 不处理积分回收——与 Creem 现状一致，人工 admin 扣回）。
6. Creem：不动任何配置；余额提干净后通知 Claude 做 Phase 2 删除。
7. Webhook 投递失败是静默的，不会主动通知：Waffo 对非 2xx 响应只走指数退避重试 3 次，之后把该条 delivery 标记 `failed`，不再重试、也不报警。Waffo dashboard 的 Webhook 日志是失败投递的唯一真相源——出现"买家反馈没收到积分"类故障时，第一步永远是去 dashboard 查那条 delivery 的状态和响应码，不是先猜代码。确认是投递失败（而非我们这边逻辑拒收）后，dashboard 里手动重发即可——`credit_ledger` 的 `external_event_id` 幂等索引保证重发不会重复入账。
8. `WAFFO_STORE_ID` 必须与 `WAFFO_MERCHANT_ID` 同批配置、且取自同一个店——两者不匹配（比如误粘了另一个商户/店铺的值）会让 `waffo-service.handleWebhook` 的 store 门把所有真实付款事件当"店不符"拒收（fail-closed，见 `apps/web/src/services/billing/waffo-service.ts`）。`assertProductionEnv` 只能拦"完全没配"，拦不住"配错了但两个变量都非空"这种笔误，上线前手动核对一遍这两个值确实来自同一个 Waffo store。

## 回滚路径

切回 Creem = 改 `apps/web/src/config/pricing.ts` 的 `ACTIVE_CHECKOUT_PROVIDER` 常量（`'waffo'` → `'creem'`）+ 重新部署。

这是一次构建时间的操作，**不是** env 变量秒级开关——`ACTIVE_CHECKOUT_PROVIDER` 是编译期常量，改它必须走一次 Vercel 构建才能生效。这是有意为之：checkout provider 切换不该是运维在事故现场手抖一个环境变量就能瞬间改变资金流向的操作。事故现场找"秒级开关"是走错方向——正确动作是改常量、提交、等一次正常部署。Creem webhook 路由（`/api/webhooks/creem`）本次全程未删，回滚后立即可用，不需要额外操作。
