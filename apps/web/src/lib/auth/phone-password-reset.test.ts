import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

import { betterAuth } from 'better-auth';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { sessions, users, verifications } from '@/db/schema';
import { cleanupUser, isDbReachable } from '@/db/repos/__test__/setup';
import { env } from '@/lib/env';
import { createAuthOptions, getAuth } from './better-auth';
import { normalizePhoneNumber } from './phone';

// 手机号找回(R1–R7、R9–R10):直接打 better-auth handler。验证码只从
// EMAIL_CAPTURE_FILE 的 kind=phone-otp-reset 行读取,不经过短信。
const BASE = 'http://localhost:3000';
const OLD_PASSWORD = 'password123';
const NEW_PASSWORD = 'newpassword123';

let phoneSeq = 0;

function localPhone(): string {
  phoneSeq += 1;
  return `138${`${Date.now()}${phoneSeq}`.slice(-8)}`;
}

function intlPhone(): string {
  phoneSeq += 1;
  return `+86139${`${Date.now()}${phoneSeq}`.slice(-8)}`;
}

function spaced(phone: string): string {
  const normalized = normalizePhoneNumber(phone);
  assert.ok(normalized, `fixture phone must normalize: ${phone}`);
  if (normalized.startsWith('+86')) {
    const national = normalized.slice(3);
    return `+86 ${national.slice(0, 3)} ${national.slice(3, 7)} ${national.slice(7)}`;
  }
  return `${normalized.slice(0, 3)} ${normalized.slice(3, 7)} ${normalized.slice(7)}`;
}

function dashed(phone: string): string {
  const normalized = normalizePhoneNumber(phone);
  assert.ok(normalized);
  if (normalized.startsWith('+86')) {
    const national = normalized.slice(3);
    return `+86-${national.slice(0, 3)}-${national.slice(3, 7)}-${national.slice(7)}`;
  }
  return `${normalized.slice(0, 3)}-${normalized.slice(3, 7)}-${normalized.slice(7)}`;
}

function jsonInit(body: unknown, cookie?: string): RequestInit {
  return {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: BASE,
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  };
}

async function callAuth(path: string, init: RequestInit, handler = getAuth().handler): Promise<Response> {
  const res = await handler(new Request(`${BASE}/api/auth${path}`, init) as never);
  return res as unknown as Response;
}

async function readBody(res: Response, what: string) {
  const text = await res.text();
  let json: Record<string, unknown> = {};
  if (text) {
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      json = {};
    }
  }
  return { status: res.status, text, json, what };
}

function captureRows(phone: string) {
  const capturePath = resolve(process.cwd(), env.EMAIL_CAPTURE_FILE);
  let text = '';
  try {
    text = readFileSync(capturePath, 'utf8');
  } catch {
    return [] as Array<{ kind?: string; phoneNumber?: string; code?: string; capturedAt?: string }>;
  }
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { kind?: string; phoneNumber?: string; code?: string; capturedAt?: string })
    .filter((row) => row.phoneNumber === phone);
}

async function waitForResetCode(phone: string, minRows = 1): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const lines = captureRows(phone).filter((row) => row.kind === 'phone-otp-reset');
    const code = lines.length >= minRows ? lines.at(-1)?.code : undefined;
    if (code) return code;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  assert.fail(`no phone-otp-reset capture row for ${phone} (need ${minRows})`);
}

async function userByPhone(phone: string) {
  const rows = await db.select().from(users).where(eq(users.phoneNumber, phone));
  return rows[0] ?? null;
}

async function sessionCount(userId: string) {
  const rows = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, userId));
  return rows.length;
}

async function clearOtps(phone: string) {
  await db.delete(verifications).where(eq(verifications.identifier, `${phone}-request-password-reset`));
}

async function signUp(phoneInput: string): Promise<{ id: string; phone: string }> {
  const phone = normalizePhoneNumber(phoneInput);
  assert.ok(phone);
  const res = await callAuth('/phone-signup', jsonInit({ phoneNumber: phoneInput, password: OLD_PASSWORD, name: 'Reset User' }));
  const body = await readBody(res, 'phone-signup');
  assert.equal(body.status, 200, `${body.what} -> ${body.status}: ${body.text}`);
  const user = body.json.user as { id: string };
  assert.ok(user?.id);
  return { id: user.id, phone };
}

test('R1/R2/R6/R10: capture OTP resets the password, revokes sessions, leaves phone unverified', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping integration test');
    return;
  }
  const raw = spaced(localPhone());
  const phone = normalizePhoneNumber(raw);
  assert.ok(phone);
  let userId: string | undefined;
  try {
    const created = await signUp(raw);
    userId = created.id;
    assert.equal(created.phone, phone);
    const before = await userByPhone(phone);
    assert.equal(before?.phoneNumberVerified, false);
    assert.ok((await sessionCount(userId)) >= 1, 'signup must open a session');

    // /sign-in/phone-number 不做服务端归一(登录表单先归一再提交)。这里用落库后的号码。
    const again = await callAuth('/sign-in/phone-number', jsonInit({ phoneNumber: phone, password: OLD_PASSWORD }));
    const signedIn = await readBody(again, 'sign-in before reset');
    assert.equal(signedIn.status, 200, signedIn.text);
    assert.ok((await sessionCount(userId)) >= 2, 'a second sign-in must add another session row');

    const requested = await callAuth(
      '/phone-number/request-password-reset',
      jsonInit({ phoneNumber: dashed(phone) }),
    );
    const requestedBody = await readBody(requested, 'request reset');
    assert.equal(requestedBody.status, 200, requestedBody.text);
    assert.equal(requestedBody.json.status, true);

    const code = await waitForResetCode(phone);
    const captured = captureRows(phone).filter((row) => row.kind === 'phone-otp-reset').at(-1);
    assert.equal(captured?.code, code);
    assert.equal(typeof captured?.capturedAt, 'string');

    const reset = await callAuth(
      '/phone-number/reset-password',
      jsonInit({ phoneNumber: spaced(phone), otp: code, newPassword: NEW_PASSWORD }),
    );
    const resetBody = await readBody(reset, 'reset password');
    assert.equal(resetBody.status, 200, resetBody.text);
    assert.equal(resetBody.json.status, true);

    assert.equal(await sessionCount(userId), 0, 'revokeSessionsOnPasswordReset must delete session rows');
    const after = await userByPhone(phone);
    assert.equal(after?.phoneNumberVerified, false, 'reset must not mark the phone verified');

    const oldLogin = await callAuth('/sign-in/phone-number', jsonInit({ phoneNumber: phone, password: OLD_PASSWORD }));
    const oldBody = await readBody(oldLogin, 'old password');
    assert.notEqual(oldBody.status, 200, 'old password must fail');

    const newLogin = await callAuth('/sign-in/phone-number', jsonInit({ phoneNumber: phone, password: NEW_PASSWORD }));
    const newBody = await readBody(newLogin, 'new password');
    assert.equal(newBody.status, 200, newBody.text);
  } finally {
    if (phone) await clearOtps(phone);
    if (userId) await cleanupUser(userId);
  }
});

test('R3: an unregistered phone gets the same success and no code', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping integration test');
    return;
  }
  const phone = localPhone();
  try {
    const res = await callAuth('/phone-number/request-password-reset', jsonInit({ phoneNumber: spaced(phone) }));
    const body = await readBody(res, 'unknown phone');
    assert.equal(body.status, 200, body.text);
    assert.equal(body.json.status, true);
    assert.equal(captureRows(phone).filter((row) => row.kind === 'phone-otp-reset').length, 0);
  } finally {
    await clearOtps(phone);
  }
});

test('R4: a bad or expired OTP does not change the password, and resend still works', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping integration test');
    return;
  }
  const phone = localPhone();
  const expiredPhone = intlPhone();
  const userIds: string[] = [];
  try {
    userIds.push((await signUp(phone)).id);
    const first = await callAuth('/phone-number/request-password-reset', jsonInit({ phoneNumber: phone }));
    assert.equal((await readBody(first, 'first code')).status, 200);
    await waitForResetCode(phone);

    const bad = await callAuth(
      '/phone-number/reset-password',
      jsonInit({ phoneNumber: phone, otp: '000000', newPassword: NEW_PASSWORD }),
    );
    const badBody = await readBody(bad, 'bad otp');
    assert.notEqual(badBody.status, 200, badBody.text);

    const stillOld = await callAuth('/sign-in/phone-number', jsonInit({ phoneNumber: phone, password: OLD_PASSWORD }));
    assert.equal((await readBody(stillOld, 'password unchanged')).status, 200);

    const resent = await callAuth('/phone-number/request-password-reset', jsonInit({ phoneNumber: phone }));
    assert.equal((await readBody(resent, 'resend')).status, 200);
    const latest = await waitForResetCode(phone, 2);
    assert.ok(captureRows(phone).filter((row) => row.kind === 'phone-otp-reset').length >= 2);

    userIds.push((await signUp(spaced(expiredPhone))).id);
    const expiredRequest = await callAuth(
      '/phone-number/request-password-reset',
      jsonInit({ phoneNumber: dashed(expiredPhone) }),
    );
    assert.equal((await readBody(expiredRequest, 'expire setup')).status, 200);
    const expiredCode = await waitForResetCode(expiredPhone);
    await db
      .update(verifications)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(verifications.identifier, `${expiredPhone}-request-password-reset`));
    const expired = await callAuth(
      '/phone-number/reset-password',
      jsonInit({ phoneNumber: expiredPhone, otp: expiredCode, newPassword: NEW_PASSWORD }),
    );
    assert.notEqual((await readBody(expired, 'expired otp')).status, 200);
    const expiredStillOld = await callAuth(
      '/sign-in/phone-number',
      jsonInit({ phoneNumber: expiredPhone, password: OLD_PASSWORD }),
    );
    assert.equal((await readBody(expiredStillOld, 'expired password unchanged')).status, 200);

    const reset = await callAuth(
      '/phone-number/reset-password',
      jsonInit({ phoneNumber: phone, otp: latest, newPassword: NEW_PASSWORD }),
    );
    assert.equal((await readBody(reset, 'resend reset')).status, 200);
  } finally {
    await clearOtps(phone);
    await clearOtps(expiredPhone);
    for (const id of userIds) await cleanupUser(id);
  }
});

test('R5: the phone reset request route returns 429 after 3 calls in an hour', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping integration test');
    return;
  }
  // 默认 auth 在 test/dev 不打开 better-auth 限流。这里单独开 enabled,验证
  // customRules 的 3/3600 会压过插件的 10 次/分钟兜底。
  const options = createAuthOptions();
  const limited = betterAuth({
    ...options,
    rateLimit: { ...options.rateLimit, enabled: true },
  });
  const phone = localPhone();
  try {
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await callAuth(
        '/phone-number/request-password-reset',
        jsonInit({ phoneNumber: phone }),
        limited.handler,
      );
      const body = await readBody(res, `rate limit ${i}`);
      statuses.push(body.status);
    }
    assert.deepEqual(statuses, [200, 200, 200, 429]);
  } finally {
    await clearOtps(phone);
  }
});

test('R7: email request-password-reset still answers 200 for an unknown address', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping integration test');
    return;
  }
  const res = await callAuth(
    '/request-password-reset',
    jsonInit({ email: `missing-${Date.now()}-${phoneSeq}@yujee.test`, redirectTo: '/zh/reset-password' }),
  );
  const body = await readBody(res, 'email reset');
  assert.equal(body.status, 200, body.text);
  assert.equal(body.json.status, true);
});

test('R9: spaced and dashed phone input normalizes to the registered value', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping integration test');
    return;
  }
  const local = localPhone();
  const intl = intlPhone();
  const ids: string[] = [];
  try {
    ids.push((await signUp(spaced(local))).id);
    const localReset = await callAuth(
      '/phone-number/request-password-reset',
      jsonInit({ phoneNumber: dashed(local) }),
    );
    assert.equal((await readBody(localReset, 'local dashed')).status, 200);
    const localCode = await waitForResetCode(local);
    assert.match(localCode, /^\d{6}$/);
    assert.equal(captureRows(dashed(local)).length, 0, 'capture must store the normalized number');

    ids.push((await signUp(spaced(intl))).id);
    const intlReset = await callAuth(
      '/phone-number/request-password-reset',
      jsonInit({ phoneNumber: dashed(intl) }),
    );
    assert.equal((await readBody(intlReset, 'intl dashed')).status, 200);
    assert.match(await waitForResetCode(intl), /^\d{6}$/);

    // +86… 与去掉国家码的国内号不是同一把钥匙:两边都走同一个归一函数,
    // 归一结果不同,就不能互相找回。
    const bare = intl.slice(3);
    const crossed = await callAuth('/phone-number/request-password-reset', jsonInit({ phoneNumber: bare }));
    assert.equal((await readBody(crossed, 'country-code is part of the key')).status, 200);
    assert.equal(captureRows(bare).filter((row) => row.kind === 'phone-otp-reset').length, 0);

    const invalid = await callAuth('/phone-number/request-password-reset', jsonInit({ phoneNumber: '13812abc' }));
    const invalidBody = await readBody(invalid, 'invalid phone');
    assert.equal(invalidBody.status, 400, invalidBody.text);
  } finally {
    await clearOtps(local);
    await clearOtps(intl);
    await clearOtps(intl.slice(3));
    for (const id of ids) await cleanupUser(id);
  }
});
