import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
  getWatchaOAuthConfig,
  normalizeWatchaProfile,
  parseWatchaScopes,
  WATCHA_PLACEHOLDER_EMAIL_DOMAIN,
  WATCHA_PROVIDER_ID,
  type WatchaOAuthEnvSource,
} from './watcha-oauth';

// 显式传参的完整配置(env 切片),门控测试不依赖进程 env —— 与 env.test.ts 同款姿势。
const FULL: WatchaOAuthEnvSource = {
  WATCHA_OAUTH_CLIENT_ID: 'watcha-client-id',
  WATCHA_OAUTH_CLIENT_SECRET: 'watcha-client-secret',
  WATCHA_OAUTH_AUTHORIZATION_URL: 'https://watcha.cn/oauth/authorize',
  WATCHA_OAUTH_TOKEN_URL: 'https://watcha.cn/oauth/token',
  WATCHA_OAUTH_USER_INFO_URL: 'https://watcha.cn/oauth/userinfo',
  WATCHA_OAUTH_SCOPES: 'openid profile',
  WEB_BASE_URL: 'https://outman.press',
};

describe('getWatchaOAuthConfig(env 门控:五件套 all-or-nothing)', () => {
  it('配齐返回 provider 配置,redirectURI 钉死标准 social 回调', () => {
    const config = getWatchaOAuthConfig(FULL);
    assert.ok(config);
    assert.equal(config.providerId, WATCHA_PROVIDER_ID);
    assert.equal(config.clientId, 'watcha-client-id');
    assert.equal(config.authorizationUrl, FULL.WATCHA_OAUTH_AUTHORIZATION_URL);
    assert.equal(config.tokenUrl, FULL.WATCHA_OAUTH_TOKEN_URL);
    assert.equal(config.redirectURI, 'https://outman.press/api/auth/callback/watcha');
    assert.deepEqual(config.scopes, ['openid', 'profile']);
    assert.equal(typeof config.getUserInfo, 'function');
  });

  it('WEB_BASE_URL 尾斜杠不产生双斜杠回调', () => {
    const config = getWatchaOAuthConfig({ ...FULL, WEB_BASE_URL: 'https://outman.press/' });
    assert.equal(config?.redirectURI, 'https://outman.press/api/auth/callback/watcha');
  });

  it('五件套缺一即整条关闭(返回 null)', () => {
    for (const key of [
      'WATCHA_OAUTH_CLIENT_ID',
      'WATCHA_OAUTH_CLIENT_SECRET',
      'WATCHA_OAUTH_AUTHORIZATION_URL',
      'WATCHA_OAUTH_TOKEN_URL',
      'WATCHA_OAUTH_USER_INFO_URL',
    ] as const) {
      const partial = { ...FULL };
      delete partial[key];
      assert.equal(
        getWatchaOAuthConfig(partial),
        null,
        `缺 ${key} 应关闭`,
      );
    }
    assert.equal(getWatchaOAuthConfig({ ...FULL, WATCHA_OAUTH_CLIENT_ID: '   ' }), null);
  });

  it('scope 没配 = 空数组(按对方文档填,不猜)', () => {
    assert.deepEqual(parseWatchaScopes(undefined), []);
    assert.deepEqual(parseWatchaScopes('  '), []);
    assert.deepEqual(parseWatchaScopes('openid profile'), ['openid', 'profile']);
    assert.deepEqual(parseWatchaScopes('openid,profile , user'), ['openid', 'profile', 'user']);
    const config = getWatchaOAuthConfig({ ...FULL, WATCHA_OAUTH_SCOPES: undefined });
    assert.deepEqual(config?.scopes, []);
  });
});

describe('normalizeWatchaProfile(字段名未知时代的宽容映射矩阵)', () => {
  it('主体标识依序兼容 id/openid/sub/userId/uid,数字也收', () => {
    assert.equal(normalizeWatchaProfile({ id: 'a1' })?.id, 'a1');
    assert.equal(normalizeWatchaProfile({ openid: 'a2' })?.id, 'a2');
    assert.equal(normalizeWatchaProfile({ sub: 'a3' })?.id, 'a3');
    assert.equal(normalizeWatchaProfile({ userId: 'a4' })?.id, 'a4');
    assert.equal(normalizeWatchaProfile({ uid: 'a5' })?.id, 'a5');
    assert.equal(normalizeWatchaProfile({ uid: 10024323 })?.id, '10024323');
  });

  it('拿不到稳定主体标识返回 null —— 不能编一个 accountId 出来', () => {
    assert.equal(normalizeWatchaProfile({ nickname: '猹友' }), null);
    assert.equal(normalizeWatchaProfile({}), null);
    assert.equal(normalizeWatchaProfile({ id: '   ' }), null);
  });

  it('昵称依序 name/nickname/username/displayName,全缺兜底「观猹用户+尾4位」', () => {
    assert.equal(normalizeWatchaProfile({ id: 'u1', name: '甲', nickname: '乙' })?.name, '甲');
    assert.equal(normalizeWatchaProfile({ id: 'u1', nickname: '乙' })?.name, '乙');
    assert.equal(normalizeWatchaProfile({ id: 'u1', username: '丙' })?.name, '丙');
    assert.equal(normalizeWatchaProfile({ id: 'u1', displayName: '丁' })?.name, '丁');
    assert.equal(normalizeWatchaProfile({ id: '10024323' })?.name, '观猹用户4323');
  });

  it('邮箱:真实邮箱才用,verified 只信显式 true;缺失/畸形合成占位且 verified=true', () => {
    const real = normalizeWatchaProfile({ id: 'u1', email: 'a@w.cn' });
    assert.equal(real?.email, 'a@w.cn');
    assert.equal(real?.emailVerified, false);

    const realVerified = normalizeWatchaProfile({ id: 'u1', email: 'a@w.cn', email_verified: true });
    assert.equal(realVerified?.emailVerified, true);

    // users.email notNull:没邮箱也要有占位(镜像手机号 @phone.yujee.local 做法)。
    const placeholder = normalizeWatchaProfile({ id: 'u9' });
    assert.equal(placeholder?.email, `watcha_u9@${WATCHA_PLACEHOLDER_EMAIL_DOMAIN}`);
    assert.equal(placeholder?.emailVerified, true);

    const malformed = normalizeWatchaProfile({ id: 'u1', email: 'not-an-email' });
    assert.equal(malformed?.email, `watcha_u1@${WATCHA_PLACEHOLDER_EMAIL_DOMAIN}`);
  });

  it('头像依序 avatar/picture/avatar_url/headimgurl', () => {
    assert.equal(normalizeWatchaProfile({ id: 'u1', avatar: 'https://x/a.png' })?.image, 'https://x/a.png');
    assert.equal(normalizeWatchaProfile({ id: 'u1', picture: 'https://x/p.png' })?.image, 'https://x/p.png');
    assert.equal(normalizeWatchaProfile({ id: 'u1', avatar_url: 'https://x/au.png' })?.image, 'https://x/au.png');
    assert.equal(normalizeWatchaProfile({ id: 'u1', headimgurl: 'https://x/h.png' })?.image, 'https://x/h.png');
    assert.equal(normalizeWatchaProfile({ id: 'u1' })?.image, undefined);
  });
});

describe('getUserInfo(自定义拉取+归一,一处收口)', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('Bearer 拉取 JSON 并归一(openid 主体 + 无邮箱占位)', async () => {
    const config = getWatchaOAuthConfig(FULL);
    assert.ok(config?.getUserInfo);
    let requestedUrl = '';
    let authHeader = '';
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestedUrl = String(input);
      authHeader = (init?.headers as Record<string, string>).Authorization ?? '';
      return new Response(JSON.stringify({ openid: 'w1', nickname: '猹友', avatar: 'https://x/a.png' }), {
        status: 200,
      });
    }) as typeof fetch;

    const profile = await config.getUserInfo({ accessToken: 'tok-1' });

    assert.equal(requestedUrl, FULL.WATCHA_OAUTH_USER_INFO_URL);
    assert.equal(authHeader, 'Bearer tok-1');
    assert.equal(profile?.id, 'w1');
    assert.equal(profile?.name, '猹友');
    assert.equal(profile?.email, `watcha_w1@${WATCHA_PLACEHOLDER_EMAIL_DOMAIN}`);
    assert.equal(profile?.image, 'https://x/a.png');
  });

  it('少数 provider 的 urlencoded 响应也能解析', async () => {
    const config = getWatchaOAuthConfig(FULL);
    assert.ok(config?.getUserInfo);
    globalThis.fetch = (async () =>
      new Response('openid=w2&email=w2%40watcha.cn&email_verified=true', { status: 200 })) as typeof fetch;

    const profile = await config.getUserInfo({ accessToken: 'tok-2' });

    assert.equal(profile?.id, 'w2');
    assert.equal(profile?.email, 'w2@watcha.cn');
    assert.equal(profile?.emailVerified, true);
  });

  it('非 2xx 或不可解析响应返回 null(按无档案处理,不编数据)', async () => {
    const config = getWatchaOAuthConfig(FULL);
    assert.ok(config?.getUserInfo);

    globalThis.fetch = (async () => new Response('boom', { status: 500 })) as typeof fetch;
    assert.equal(await config.getUserInfo({ accessToken: 't' }), null);

    globalThis.fetch = (async () => new Response('not-json-nor-form', { status: 200 })) as typeof fetch;
    assert.equal(await config.getUserInfo({ accessToken: 't' }), null);
  });
});
