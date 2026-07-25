import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertProductionEnv, isRealProduction } from './env';

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
