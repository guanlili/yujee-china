import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { buildPasswordResetEmail, buildSocialProviders, createAuthOptions, getBetterAuthSchema, localeFromResetUrl, normalizePhoneNumber, PHONE_AUTH_LINK_PATHS } from './better-auth';
import { FREE_PLAN_CREDITS } from '@/config/pricing';

describe('normalizePhoneNumber(手机号归一)', () => {
  it('strips spaces/dashes/parens and accepts 5-15 digits with optional +', () => {
    assert.equal(normalizePhoneNumber('13812345678'), '13812345678');
    assert.equal(normalizePhoneNumber('+86 138-1234-5678'), '+8613812345678');
    assert.equal(normalizePhoneNumber('(138) 1234 5678'), '13812345678');
  });

  it('rejects anything with non-digits, or too short/long digit runs', () => {
    assert.equal(normalizePhoneNumber('1381234567a'), null);
    assert.equal(normalizePhoneNumber('abc@x'), null);
    assert.equal(normalizePhoneNumber('1234'), null);
    assert.equal(normalizePhoneNumber('123456789012345678'), null);
    assert.equal(normalizePhoneNumber('++8613812345678'), null);
  });
});

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

    const ids = options.plugins?.map((p) => p.id) ?? [];
    // anonymous 插件的转正 after-hook 要从 responseHeaders 读 set-cookie,
    // nextCookies() 必须是最后一个插件。中间夹着谁(2026-10 起是手机号两件套)
    // 不影响该契约 —— 断言顺序而非死数,加插件不需要改这里。
    assert.ok(ids.length >= 2, `plugins: ${ids.join(',')}`);
    assert.equal(ids[0], 'anonymous');
    assert.equal(ids[ids.length - 1], 'next-cookies');
    assert.ok(ids.includes('phone-number'));
    assert.ok(ids.includes('yujee-phone-signup'));
  });

  it('declares the explicit anon-link paths for phone auth (independent of the plugin matcher)', () => {
    // /phone-signup 不在 anonymous 插件转正 matcher 的前缀名单里,必须显式接管;
    // /sign-in/phone-number 虽被 matcher 覆盖,显式接管让它不依赖插件版本行为。
    assert.ok(PHONE_AUTH_LINK_PATHS.has('/phone-signup'));
    assert.ok(PHONE_AUTH_LINK_PATHS.has('/sign-in/phone-number'));
    assert.equal(PHONE_AUTH_LINK_PATHS.size, 2);
  });

  it('registers a single after-hook middleware (options-level after must not be an array)', () => {
    const options = createAuthOptions({
      users: {},
      sessions: {},
      accounts: {},
      verifications: {},
    });

    // better-auth 1.7.12 的 getHooks 把 options.hooks.after 整体当作单一 handler,
    // 传数组会在每个请求上炸 'hook.handler is not a function'(匿名注册都 500)。
    // 两条匿名并号逻辑(verify-email 兜底 + 手机号显式并号)由这一个分派器串起。
    const after = options.hooks?.after;
    assert.equal(typeof after, 'function', 'hooks.after must be one callable middleware');
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

  it('falls back to the default locale for a missing, unknown or malformed callbackURL', () => {
    assert.equal(localeFromResetUrl('https://yujeeai.com/api/auth/reset-password/tok123'), 'zh');
    assert.equal(localeFromResetUrl(url('/reset-password')), 'zh');
    assert.equal(localeFromResetUrl('not a url'), 'zh');
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

describe('social providers(国内版无 Google)', () => {
  it('does not wire the google provider even if GOOGLE_* lingers in the environment', () => {
    // GOOGLE_* 字段在 env.ts 保留一迭代(兼容存量环境),但挂载点已删:
    // 钉住源码里不再出现 providers.google / env.GOOGLE_ 的接线,防止照着旧
    // 注释把分支加回来(真挂回去,配了 env 的环境就会多出一个不该有的入口)。
    const src = readFileSync(join(process.cwd(), 'src/lib/auth/better-auth.ts'), 'utf8');
    assert.doesNotMatch(src, /providers\.google|env\.GOOGLE_/, 'google provider must not be wired');
  });

  it('buildSocialProviders returns at most apple', () => {
    const providers = buildSocialProviders();
    assert.ok(
      !providers || !('google' in providers),
      `unexpected google in socialProviders: ${Object.keys(providers ?? {}).join(',')}`,
    );
  });

  it('createAuthOptions mounts no google social provider', () => {
    const options = createAuthOptions({
      users: {},
      sessions: {},
      accounts: {},
      verifications: {},
    });
    const social = options.socialProviders as Record<string, unknown> | undefined;
    assert.ok(!social || !('google' in social), 'socialProviders must not include google');
  });
});
