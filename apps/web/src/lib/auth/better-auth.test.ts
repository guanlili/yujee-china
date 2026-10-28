import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';

import { env } from '@/lib/env';
import { buildPasswordResetEmail, buildSocialProviders, buildTrustedOrigins, createAuthOptions, getBetterAuthSchema, localeFromResetUrl, normalizePhoneNumber, PHONE_AUTH_LINK_PATHS } from './better-auth';
import { FREE_PLAN_CREDITS } from '@/config/pricing';

describe('normalizePhoneNumber(手机号归一,大陆 11 位)', () => {
  it('accepts mainland numbers, stripping spaces/dashes/parens and the +86 prefix', () => {
    assert.equal(normalizePhoneNumber('13812345678'), '13812345678');
    assert.equal(normalizePhoneNumber('+86 138-1234-5678'), '13812345678');
    assert.equal(normalizePhoneNumber('(138) 1234 5678'), '13812345678');
    assert.equal(normalizePhoneNumber('+8613812345678'), '13812345678');
  });

  it('rejects non-mainland formats and malformed input (D5: 仅大陆 11 位)', () => {
    assert.equal(normalizePhoneNumber('1381234567a'), null); // 含字母
    assert.equal(normalizePhoneNumber('abc@x'), null);
    assert.equal(normalizePhoneNumber('1234'), null); // 过短
    assert.equal(normalizePhoneNumber('123456789012345678'), null); // 过长
    assert.equal(normalizePhoneNumber('++8613812345678'), null);
    assert.equal(normalizePhoneNumber('23812345678'), null); // 1[3-9] 开头之外
    assert.equal(normalizePhoneNumber('1381234567'), null); // 10 位
    assert.equal(normalizePhoneNumber('138123456789'), null); // 12 位
    assert.equal(normalizePhoneNumber('+85212345678'), null); // 港澳台/国际
    assert.equal(normalizePhoneNumber('85312345678'), null); // 裸国际号
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
    // /phone-signup 与 /phone-number/verify 都不在 anonymous 插件转正 matcher 的
    // 前缀名单里(只认 /sign-in、/sign-up、/callback),必须显式接管 —— 漏了
    // /phone-number/verify,游客用验证码登录后其书会滞留匿名号(方案 §4.1);
    // /sign-in/phone-number 虽被 matcher 覆盖,显式接管让它不依赖插件版本行为。
    assert.ok(PHONE_AUTH_LINK_PATHS.has('/phone-signup'));
    assert.ok(PHONE_AUTH_LINK_PATHS.has('/sign-in/phone-number'));
    assert.ok(PHONE_AUTH_LINK_PATHS.has('/phone-number/verify'));
    assert.equal(PHONE_AUTH_LINK_PATHS.size, 3);
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
    // before 同样只能是单个 middleware:手机号找回归一与匿名限流由这一个分派器串起。
    assert.equal(typeof options.hooks?.before, 'function', 'hooks.before must be one callable middleware');
  });

  it('wires sendPasswordResetOTP into capture and throttles phone reset requests', async () => {
    const options = createAuthOptions({
      users: {},
      sessions: {},
      accounts: {},
      verifications: {},
    });

    // 找回路径不回落 sendOTP。漏接 sendPasswordResetOTP 时插件仍对已注册号返回
    // 成功,但永远不写验证码(K1)。requireVerification 保持默认关(D7)。
    const plugin = options.plugins?.find((p) => p.id === 'phone-number') as {
      options?: {
        sendOTP?: (data: { phoneNumber: string; code: string }) => Promise<void>;
        sendPasswordResetOTP?: (data: { phoneNumber: string; code: string }) => Promise<void>;
        requireVerification?: boolean;
      };
    } | undefined;
    assert.equal(typeof plugin?.options?.sendOTP, 'function');
    assert.equal(typeof plugin?.options?.sendPasswordResetOTP, 'function');
    assert.notEqual(plugin?.options?.requireVerification, true);
    assert.deepEqual(options.rateLimit?.customRules?.['/phone-number/request-password-reset'], {
      window: 3600,
      max: 3,
    });
    // 发码两入口(登录/注册)与插件兜底之外的应用层按 IP 限流(方案 §5.1 第②层)。
    assert.deepEqual(options.rateLimit?.customRules?.['/phone-number/send-otp'], {
      window: 60,
      max: 3,
    });
    assert.deepEqual(options.rateLimit?.customRules?.['/phone-signup/send-otp'], {
      window: 60,
      max: 3,
    });

    const phone = `19900${String(Date.now()).slice(-6)}`;
    await plugin?.options?.sendPasswordResetOTP?.({ phoneNumber: phone, code: '654321' });
    await plugin?.options?.sendOTP?.({ phoneNumber: phone, code: '111111' });

    const capturePath = resolve(process.cwd(), env.EMAIL_CAPTURE_FILE);
    const lines = readFileSync(capturePath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { kind?: string; phoneNumber?: string; code?: string; capturedAt?: string })
      .filter((row) => row.phoneNumber === phone);
    assert.deepEqual(
      lines.map((row) => ({ kind: row.kind, code: row.code })),
      [
        { kind: 'phone-otp-reset', code: '654321' },
        { kind: 'phone-otp', code: '111111' },
      ],
    );
    assert.ok(lines.every((row) => typeof row.capturedAt === 'string' && row.capturedAt.length > 0));
  });

  it('requires the OTP code on /phone-signup (D3: 注册强制验证)', () => {
    const options = createAuthOptions({
      users: {},
      sessions: {},
      accounts: {},
      verifications: {},
    });
    const signup = options.plugins?.find((p) => p.id === 'yujee-phone-signup') as {
      endpoints?: {
        signUpWithPhone?: { options?: { body?: { safeParse: (input: unknown) => { success: boolean } } } };
      };
    } | undefined;
    const body = signup?.endpoints?.signUpWithPhone?.options?.body;
    assert.ok(body, '/phone-signup must declare a body schema');
    // 漏 code(免验证期旧形态)必须被 schema 拒掉;带 code 的完整形态通过。
    assert.equal(
      body.safeParse({ phoneNumber: '13812345678', password: 'password123' }).success,
      false,
      'signup without code must fail validation',
    );
    assert.equal(
      body.safeParse({ phoneNumber: '13812345678', password: 'password123', code: '123456' }).success,
      true,
    );
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
    assert.deepEqual(buildTrustedOrigins('http://localhost:3000'), [
      'http://localhost:3000',
      'https://localhost:3000',
      'http://127.0.0.1:3000',
      'https://127.0.0.1:3000',
      'http://localhost:3210',
      'https://localhost:3210',
      'http://127.0.0.1:3210',
      'https://127.0.0.1:3210',
      'https://appleid.apple.com',
    ]);
  });

  it('trusts production WEB_BASE_URL and its www variant for CSRF', () => {
    assert.deepEqual(buildTrustedOrigins('https://outman.press'), [
      'http://localhost:3000',
      'https://localhost:3000',
      'http://127.0.0.1:3000',
      'https://127.0.0.1:3000',
      'http://localhost:3210',
      'https://localhost:3210',
      'http://127.0.0.1:3210',
      'https://127.0.0.1:3210',
      'https://outman.press',
      'https://www.outman.press',
      'https://appleid.apple.com',
    ]);
  });

  it('createAuthOptions wires trustedOrigins from env WEB_BASE_URL', () => {
    const options = createAuthOptions({
      users: {},
      sessions: {},
      accounts: {},
      verifications: {},
    });

    assert.ok(Array.isArray(options.trustedOrigins));
    assert.ok(options.trustedOrigins?.includes('https://appleid.apple.com'));
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
    `https://outman.press/api/auth/reset-password/tok123?callbackURL=${encodeURIComponent(callback)}`;

  it('reads the locale back out of the callbackURL better-auth built', () => {
    assert.equal(localeFromResetUrl(url('/zh/reset-password')), 'zh');
    assert.equal(localeFromResetUrl(url('/ja/reset-password')), 'ja');
  });

  it('reads the locale from an absolute same-origin callbackURL too', () => {
    // originCheck accepts absolute same-origin URLs, not just relative paths,
    // so detectLocale must not be handed a whole URL — it splits on '/' and
    // would read the scheme as the locale segment.
    assert.equal(
      localeFromResetUrl(url('https://outman.press/ja/reset-password')),
      'ja',
    );
  });

  it('falls back to the default locale for a missing, unknown or malformed callbackURL', () => {
    assert.equal(localeFromResetUrl('https://outman.press/api/auth/reset-password/tok123'), 'zh');
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
