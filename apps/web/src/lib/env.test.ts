import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertProductionEnv, isRealProduction, productionWarnings } from './env';

const FULL_PROD = {
  DATABASE_URL: 'postgresql://u:p@db.example.com:5432/yujee',
  WEB_BASE_URL: 'https://yujeeai.com',
  BETTER_AUTH_SECRET: 'a-real-secret-that-is-long-enough',
  AGENT_BASE_URL: 'https://yujee-agent.fly.dev',
  AGENT_SHARED_SECRET: 'a-real-agent-secret',
  DESIGN_AGENT_BASE_URL: 'https://yujee-design-agent.fly.dev',
  DESIGN_AGENT_SHARED_SECRET: 'a-real-design-secret',
};

test('isRealProduction: VERCEL_ENV 优先于 NODE_ENV', () => {
  // Vercel 的 preview/development 构建同样跑在 NODE_ENV=production 下 —— 不能只看 NODE_ENV,
  // 否则每个 PR 预览都会因为 Preview 环境缺变量而炸。
  assert.equal(isRealProduction({ NODE_ENV: 'production', VERCEL_ENV: 'preview' }), false);
  assert.equal(isRealProduction({ NODE_ENV: 'production', VERCEL_ENV: 'development' }), false);
  assert.equal(isRealProduction({ NODE_ENV: 'production', VERCEL_ENV: 'production' }), true);
});

test('isRealProduction: 没有 VERCEL_ENV 时(自托管)回落到 NODE_ENV', () => {
  assert.equal(isRealProduction({ NODE_ENV: 'production' }), true);
  assert.equal(isRealProduction({ NODE_ENV: 'development' }), false);
  assert.equal(isRealProduction({ NODE_ENV: 'test' }), false);
  assert.equal(isRealProduction({}), false);
});

test('assertProductionEnv: 非生产环境一律放行(本地零配置仍然起得来)', () => {
  assert.doesNotThrow(() => assertProductionEnv({ NODE_ENV: 'development' }));
  assert.doesNotThrow(() => assertProductionEnv({ NODE_ENV: 'test' }));
  assert.doesNotThrow(() => assertProductionEnv({ NODE_ENV: 'production', VERCEL_ENV: 'preview' }));
});

test('assertProductionEnv: 真生产变量齐全时放行', () => {
  assert.doesNotThrow(() =>
    assertProductionEnv({ ...FULL_PROD, NODE_ENV: 'production', VERCEL_ENV: 'production' }),
  );
});

test('assertProductionEnv: 真生产缺任何一个必需变量都要当场抛', () => {
  for (const key of Object.keys(FULL_PROD)) {
    const raw: Record<string, string | undefined> = { ...FULL_PROD, NODE_ENV: 'production', VERCEL_ENV: 'production' };
    delete raw[key];
    assert.throws(
      () => assertProductionEnv(raw),
      new RegExp(key),
      `缺 ${key} 时应当 fail-fast,而不是带着 dev 默认值静默启动`,
    );
  }
});

test('assertProductionEnv: 空串和纯空格等同于缺失', () => {
  assert.throws(
    () => assertProductionEnv({ ...FULL_PROD, AGENT_SHARED_SECRET: '   ', NODE_ENV: 'production' }),
    /AGENT_SHARED_SECRET/,
  );
  assert.throws(
    () => assertProductionEnv({ ...FULL_PROD, DATABASE_URL: '', NODE_ENV: 'production' }),
    /DATABASE_URL/,
  );
});

test('assertProductionEnv: 一次报全部缺失项,不用逐个试', () => {
  const raw: Record<string, string | undefined> = { NODE_ENV: 'production', VERCEL_ENV: 'production' };
  assert.throws(() => assertProductionEnv(raw), (err: unknown) => {
    assert.ok(err instanceof Error);
    for (const key of Object.keys(FULL_PROD)) {
      assert.match(err.message, new RegExp(key), `报错信息应当包含 ${key}`);
    }
    return true;
  });
});

// WAFFO_ENV 默认 'test'。verifyWebhook 是显式传 { environment: env.WAFFO_ENV } 调的,
// 只会用该环境对应的公钥验签,不会自动兼容试另一把——漏配时真实 live 事件会直接签名
// 失败返回 400(而非静默 ack),Waffo 重试耗尽后标记 delivery failed(细节见 env.ts
// 守卫注释)。生产一旦配了 WAFFO_MERCHANT_ID(代表 Waffo 已启用),就必须显式把
// WAFFO_ENV 设成 'prod'。
test('assertProductionEnv: 真生产配了 WAFFO_MERCHANT_ID 但 WAFFO_ENV 不是 prod → 当场抛', () => {
  assert.throws(
    () =>
      assertProductionEnv({
        ...FULL_PROD,
        NODE_ENV: 'production',
        VERCEL_ENV: 'production',
        WAFFO_MERCHANT_ID: 'MER_live1234567890123456',
        WAFFO_ENV: 'test',
      }),
    /WAFFO_ENV/,
    '漏配 WAFFO_ENV=prod 应当 fail-fast,而不是带着默认 test 环境静默丢单',
  );
});

test('assertProductionEnv: 真生产配了 WAFFO_MERCHANT_ID 且未设 WAFFO_ENV(落到默认 test)→ 同样当场抛', () => {
  assert.throws(
    () =>
      assertProductionEnv({
        ...FULL_PROD,
        NODE_ENV: 'production',
        VERCEL_ENV: 'production',
        WAFFO_MERCHANT_ID: 'MER_live1234567890123456',
      }),
    /WAFFO_ENV/,
  );
});

test('assertProductionEnv: 真生产配了 WAFFO_MERCHANT_ID 且显式 WAFFO_ENV=prod(及 WAFFO_STORE_ID)→ 放行', () => {
  assert.doesNotThrow(() =>
    assertProductionEnv({
      ...FULL_PROD,
      NODE_ENV: 'production',
      VERCEL_ENV: 'production',
      WAFFO_MERCHANT_ID: 'MER_live1234567890123456',
      WAFFO_ENV: 'prod',
      WAFFO_STORE_ID: 'STO_live1234567890123456',
    }),
  );
});

test('assertProductionEnv: 真生产没配 WAFFO_MERCHANT_ID(Waffo 未启用)→ 不因 WAFFO_ENV 抛', () => {
  assert.doesNotThrow(() =>
    assertProductionEnv({ ...FULL_PROD, NODE_ENV: 'production', VERCEL_ENV: 'production', WAFFO_ENV: 'test' }),
  );
});

test('assertProductionEnv: 非生产环境即使配了 WAFFO_MERCHANT_ID 也不检查 WAFFO_ENV', () => {
  assert.doesNotThrow(() =>
    assertProductionEnv({ NODE_ENV: 'development', WAFFO_MERCHANT_ID: 'MER_live1234567890123456', WAFFO_ENV: 'test' }),
  );
});

// WAFFO_STORE_ID 是 webhook 的租户边界安全控制(waffo-service.handleWebhook 的 store 门
// fail-closed:未配置就拒收全部事件,见 waffo-service.test.ts)。真生产已经显式设对了
// WAFFO_ENV=prod,却漏配 WAFFO_STORE_ID:上线后 store 门会把所有付款 webhook 当"未配置"
// 拒收,不发积分,而且不会像其它变量那样连错服务发出明显信号。
test('assertProductionEnv: 真生产配了 WAFFO_MERCHANT_ID 且 WAFFO_ENV=prod 但缺 WAFFO_STORE_ID → 当场抛', () => {
  assert.throws(
    () =>
      assertProductionEnv({
        ...FULL_PROD,
        NODE_ENV: 'production',
        VERCEL_ENV: 'production',
        WAFFO_MERCHANT_ID: 'MER_live1234567890123456',
        WAFFO_ENV: 'prod',
      }),
    /WAFFO_STORE_ID/,
    '漏配 WAFFO_STORE_ID 应当 fail-fast——webhook store 门 fail-closed 会拒收所有事件、不发积分',
  );
});

// ── 抠图 mask 的降级必须有声音 ─────────────────────────────────────────────
// 没配 AGENT_CLIP_BASE_URL 时,整条服务端 mask 链路会**静默**退回浏览器端漫水填充
// (那正是 2026-08-29 验证否决的那套)。功能"上线了",用户拿到的还是被啃残的抠图,
// 而且没有任何信号。这正是这批一路在打的病:东西造好了、某一环没接、没人知道。
//
// 处置口径:**不硬失败**(断网/worker 挂了时退回兜底仍然强过整个抠不了),
// 但真生产缺配置要在启动期喊一声。

test('productionWarnings: 真生产没配 AGENT_CLIP_BASE_URL → 出一条启动告警(不抛)', () => {
  const raw = { ...FULL_PROD, NODE_ENV: 'production', VERCEL_ENV: 'production' };
  assert.doesNotThrow(() => assertProductionEnv(raw));
  const warnings = productionWarnings(raw);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /AGENT_CLIP_BASE_URL/);
  // 说清后果,不是一句「未配置」。
  assert.match(warnings[0]!, /抠图|cutout/i);
});

test('productionWarnings: 配了 AGENT_CLIP_BASE_URL 就不再唠叨', () => {
  const warnings = productionWarnings({
    ...FULL_PROD,
    NODE_ENV: 'production',
    VERCEL_ENV: 'production',
    AGENT_CLIP_BASE_URL: 'https://yujee-agent-clip.fly.dev',
  });
  assert.deepEqual(warnings, []);
});

test('productionWarnings: 非生产环境不唠叨(本地零配置仍然安静)', () => {
  assert.deepEqual(productionWarnings({ ...FULL_PROD, NODE_ENV: 'development' }), []);
});

test('assertProductionEnv: 只配了 AGENT_CLIP_SECRET 却没配 base URL → 当场抛(半配等于没配)', () => {
  assert.throws(
    () => assertProductionEnv({
      ...FULL_PROD,
      NODE_ENV: 'production',
      VERCEL_ENV: 'production',
      AGENT_CLIP_SECRET: 'a-real-clip-secret',
    }),
    /AGENT_CLIP_BASE_URL/,
  );
});

test('assertProductionEnv: 两个都配齐 → 放行', () => {
  assert.doesNotThrow(() => assertProductionEnv({
    ...FULL_PROD,
    NODE_ENV: 'production',
    VERCEL_ENV: 'production',
    AGENT_CLIP_BASE_URL: 'https://yujee-agent-clip.fly.dev',
    AGENT_CLIP_SECRET: 'a-real-clip-secret',
  }));
});
