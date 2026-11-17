import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertProductionEnv, isRealProduction, productionWarnings } from './env';

const FULL_PROD = {
  DATABASE_URL: 'postgresql://u:p@db.example.com:5432/yujee',
  WEB_BASE_URL: 'https://outman.press',
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

// ── 短信 OTP 的 aliyun 开关必须有四件套 ──────────────────────────────────────
// SMS_DELIVERY=aliyun 却没配阿里云四件套:验证码登录/注册/手机找回会静默发不出
// 短信(接口层看不出,用户只是收不到码)—— 欠费/漏配是这类故障的主形状。
// 宁可启动即炸(fail-fast),也不要带着静默故障上线;capture 模式四件套可缺
// (作为阿里云故障期的应急降级通道)。
const ALIYUN_SMS_CONFIG = {
  ALIYUN_SMS_ACCESS_KEY_ID: 'LTAI_ram_subaccount',
  ALIYUN_SMS_ACCESS_KEY_SECRET: 'a-real-sms-secret',
  ALIYUN_SMS_SIGN_NAME: '北京知景方略信息科技',
  ALIYUN_SMS_TEMPLATE_CODE: 'SMS_000000000',
};

test('assertProductionEnv: 真生产 SMS_DELIVERY=aliyun 缺任何一个短信配置 → 当场抛', () => {
  for (const key of Object.keys(ALIYUN_SMS_CONFIG)) {
    const raw: Record<string, string | undefined> = {
      ...FULL_PROD,
      ...ALIYUN_SMS_CONFIG,
      SMS_DELIVERY: 'aliyun',
      NODE_ENV: 'production',
      VERCEL_ENV: 'production',
    };
    delete raw[key];
    assert.throws(
      () => assertProductionEnv(raw),
      new RegExp(key),
      `缺 ${key} 时应当 fail-fast,而不是让验证码静默发不出`,
    );
  }
});

test('assertProductionEnv: 真生产 SMS_DELIVERY=aliyun 四件套配齐 → 放行', () => {
  assert.doesNotThrow(() => assertProductionEnv({
    ...FULL_PROD,
    ...ALIYUN_SMS_CONFIG,
    SMS_DELIVERY: 'aliyun',
    NODE_ENV: 'production',
    VERCEL_ENV: 'production',
  }));
});

test('assertProductionEnv: 真生产 SMS_DELIVERY 不设或为 capture → 不因短信四件套缺失抛', () => {
  // capture 是合法形态(本地/CI/应急降级),四件套缺着也不拦。
  assert.doesNotThrow(() => assertProductionEnv({
    ...FULL_PROD,
    NODE_ENV: 'production',
    VERCEL_ENV: 'production',
    SMS_DELIVERY: 'capture',
  }));
  const withoutDelivery: Record<string, string | undefined> = {
    ...FULL_PROD,
    NODE_ENV: 'production',
    VERCEL_ENV: 'production',
  };
  delete withoutDelivery.SMS_DELIVERY;
  assert.doesNotThrow(() => assertProductionEnv(withoutDelivery));
});

test('assertProductionEnv: 非生产环境 SMS_DELIVERY=aliyun 不检查四件套', () => {
  assert.doesNotThrow(() => assertProductionEnv({
    NODE_ENV: 'development',
    SMS_DELIVERY: 'aliyun',
  }));
});
