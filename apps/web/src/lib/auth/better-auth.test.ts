import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildPasswordResetEmail, createAuthOptions, getBetterAuthSchema, localeFromResetUrl } from './better-auth';
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

  it('enables password reset and revokes every session once the password changes', () => {
    const options = createAuthOptions({
      users: {},
      sessions: {},
      accounts: {},
      verifications: {},
    });

    // Without sendResetPassword better-auth answers /request-password-reset with
    // a flat 400 "Reset password isn't enabled" — the link on /login went nowhere.
    assert.equal(typeof options.emailAndPassword?.sendResetPassword, 'function');
    assert.equal(options.emailAndPassword?.resetPasswordTokenExpiresIn, 3600);
    // A reset is how someone recovers a hijacked account; the attacker's session
    // must not survive it. (cookieCache means the revoked cookie still answers
    // for up to its 5-minute maxAge — see the comment at the config.)
    assert.equal(options.emailAndPassword?.revokeSessionsOnPasswordReset, true);
  });

  it('clears the unverified flag on reset instead of stranding the account', () => {
    const options = createAuthOptions({
      users: {},
      sessions: {},
      accounts: {},
      verifications: {},
    });

    // requireEmailVerification + a reset that leaves emailVerified=false is a
    // closed loop: the reset "succeeds" and the next login still 403s, forever.
    assert.equal(typeof options.emailAndPassword?.onPasswordReset, 'function');
  });

  it('throttles the reset mailer, which is unauthenticated and sends real email', () => {
    const options = createAuthOptions({
      users: {},
      sessions: {},
      accounts: {},
      verifications: {},
    });

    // better-auth's built-in special rules cover /sign-in, /sign-up,
    // /change-password and /change-email only — this path would otherwise fall
    // to the default 100-per-10s, i.e. ~600 mails a minute at someone's inbox.
    assert.deepEqual(options.rateLimit?.customRules?.['/request-password-reset'], {
      window: 3600,
      max: 3,
    });
  });
});

describe('password reset email', () => {
  const url = (callback: string) =>
    `https://yujeeai.com/api/auth/reset-password/tok123?callbackURL=${encodeURIComponent(callback)}`;

  it('reads the locale back out of the callbackURL better-auth built', () => {
    assert.equal(localeFromResetUrl(url('/zh/reset-password')), 'zh');
    assert.equal(localeFromResetUrl(url('/ja/reset-password')), 'ja');
  });

  it('reads the locale from an absolute same-origin callbackURL too', () => {
    // originCheck accepts absolute same-origin URLs, not just relative paths,
    // so detectLocale must not be handed a whole URL — it splits on '/' and
    // would read the scheme as the locale segment.
    assert.equal(
      localeFromResetUrl(url('https://yujeeai.com/ja/reset-password')),
      'ja',
    );
  });

  it('falls back to English for a missing, unknown or malformed callbackURL', () => {
    assert.equal(localeFromResetUrl('https://yujeeai.com/api/auth/reset-password/tok123'), 'en');
    assert.equal(localeFromResetUrl(url('/reset-password')), 'en');
    assert.equal(localeFromResetUrl('not a url'), 'en');
  });

  it('addresses the reset email to the user and carries the reset link', () => {
    const email = buildPasswordResetEmail(
      { email: 'ava@example.com', name: 'Ava' },
      url('/zh/reset-password'),
    );

    assert.equal(email.to, 'ava@example.com');
    assert.equal(email.subject, '重置你的 Yujee 密码');
    assert.match(email.html, /Ava/);
    assert.match(email.html, /reset-password\/tok123/);
  });

  it('greets by email when the account has no name', () => {
    const email = buildPasswordResetEmail(
      { email: 'ava@example.com', name: null },
      url('/en/reset-password'),
    );

    assert.match(email.html, /ava@example\.com/);
  });
});
