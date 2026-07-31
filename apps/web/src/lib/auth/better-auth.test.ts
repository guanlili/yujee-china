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

  it('registers nextCookies outside production for route handlers', () => {
    const options = createAuthOptions({
      users: {},
      sessions: {},
      accounts: {},
      verifications: {},
    });

    assert.equal(options.plugins?.length, 1);
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
