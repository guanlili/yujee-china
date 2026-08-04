import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createAuthOptions, getBetterAuthSchema } from './better-auth';
import { FREE_PLAN_CREDITS } from '@/config/pricing';

describe('better-auth schema bridge', () => {
  it('maps B2 plural table exports to better-auth singular model names', () => {
    const users = { name: 'users' };
    const sessions = { name: 'sessions' };
    const accounts = { name: 'accounts' };
    const verifications = { name: 'verifications' };

    assert.deepEqual(
      getBetterAuthSchema({ users, sessions, accounts, verifications }),
      {
        user: users,
        session: sessions,
        account: accounts,
        verification: verifications,
      },
    );
  });

  it('fails loudly until B2 provides all four better-auth tables', () => {
    assert.throws(
      () => getBetterAuthSchema({ users: {} }),
      /Missing better-auth tables from B2 schema: sessions, accounts, verifications/,
    );
  });

  it('declares B2 user additional fields for better-auth', () => {
    const options = createAuthOptions({
      users: {},
      sessions: {},
      accounts: {},
      verifications: {},
    });

    assert.deepEqual(options.user?.additionalFields, {
      isAdmin: {
        type: 'boolean',
        required: false,
        defaultValue: false,
        input: false,
      },
      creditBalance: {
        type: 'number',
        required: false,
        defaultValue: FREE_PLAN_CREDITS,
        input: false,
      },
    });
  });

  it('registers anonymous before nextCookies (cookie middleware must run last)', () => {
    const options = createAuthOptions({
      users: {},
      sessions: {},
      accounts: {},
      verifications: {},
    });

    assert.equal(options.plugins?.length, 2);
    // anonymous 插件的转正 after-hook 要从 responseHeaders 读 set-cookie,
    // nextCookies() 必须是最后一个插件。
    assert.equal(options.plugins?.[0]?.id, 'anonymous');
    assert.equal(options.plugins?.[1]?.id, 'next-cookies');
  });

  it('zeroes the welcome credits for anonymous (guest) user creation only', async () => {
    const options = createAuthOptions({
      users: {},
      sessions: {},
      accounts: {},
      verifications: {},
    });

    const before = options.databaseHooks?.user?.create?.before;
    assert.ok(before, 'databaseHooks.user.create.before must exist');

    const anonUser = { email: 'temp@x.com', isAnonymous: true, creditBalance: FREE_PLAN_CREDITS };
    const anonResult = (await before(anonUser as never, null)) as {
      data: { creditBalance: number };
    };
    assert.equal(anonResult.data.creditBalance, 0);

    const realUser = { email: 'real@x.com', creditBalance: FREE_PLAN_CREDITS };
    const realResult = await before(realUser as never, null);
    assert.equal(realResult, undefined); // 不动真实注册:defaultValue 20 照旧
  });

  it('trusts common local dev origins used by alternate ports', () => {
    const options = createAuthOptions({
      users: {},
      sessions: {},
      accounts: {},
      verifications: {},
    });

    assert.deepEqual(options.trustedOrigins, [
      'http://localhost:3000',
      'https://localhost:3000',
      'http://127.0.0.1:3000',
      'https://127.0.0.1:3000',
      'http://localhost:3210',
      'https://localhost:3210',
      'http://127.0.0.1:3210',
      'https://127.0.0.1:3210',
      // Apple 登录:appleid.apple.com 以 form_post 跨站回调,必须列入信任(见 better-auth.ts)。
      'https://appleid.apple.com',
    ]);
  });
});
