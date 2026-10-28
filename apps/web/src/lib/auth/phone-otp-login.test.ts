import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { users, verifications } from '@/db/schema';
import { albumRepo } from '@/db/repos/album-repo';
import { cleanupUser, isDbReachable, makeAlbum } from '@/db/repos/__test__/setup';
import { env } from '@/lib/env';
import { getAuth } from './better-auth';
import { normalizePhoneNumber } from './phone';

// 验证码登录 + 注册 OTP(D1/D3,2026-10-28):直接驱动真实 better-auth handler,
// 连 before-hook 的发码门与 after-hook 的游客并号一起验,不 mock。capture 模式下
// 验证码落 EMAIL_CAPTURE_FILE(kind=phone-otp,scene 区分 login/signup)。
const BASE = 'http://localhost:3000';
const PASSWORD = 'password123';

let phoneSeq = 0;

function localPhone(): string {
  phoneSeq += 1;
  return `138${`${Date.now()}${phoneSeq}`.slice(-8)}`;
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

async function callAuth(path: string, init: RequestInit): Promise<Response> {
  const res = await getAuth().handler(new Request(`${BASE}/api/auth${path}`, init) as never);
  return res as unknown as Response;
}

interface AuthJson {
  user?: { id: string; phoneNumberVerified?: boolean };
  [key: string]: unknown;
}

async function readJson(res: Response, what: string, expectStatus?: number): Promise<AuthJson> {
  const text = await res.text();
  if (expectStatus !== undefined) {
    assert.equal(res.status, expectStatus, `${what} -> ${res.status}: ${text}`);
  }
  return (text ? JSON.parse(text) : {}) as AuthJson;
}

function cookieHeaderFrom(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
}

type CapturedRow = { kind?: string; scene?: string; phoneNumber?: string; code?: string };

function captureRows(phone: string): CapturedRow[] {
  let text = '';
  try {
    text = readFileSync(resolve(process.cwd(), env.EMAIL_CAPTURE_FILE), 'utf8');
  } catch {
    return [];
  }
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CapturedRow)
    .filter((row) => row.phoneNumber === phone);
}

async function waitForCode(phone: string, scene: 'login' | 'signup'): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const row = captureRows(phone).filter((r) => r.kind === 'phone-otp' && r.scene === scene).at(-1);
    if (row?.code) return row.code;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  assert.fail(`no ${scene} otp capture row for ${phone}`);
}

async function userByPhone(phone: string) {
  const rows = await db.select().from(users).where(eq(users.phoneNumber, phone));
  return rows[0] ?? null;
}

async function verificationRow(identifier: string) {
  const rows = await db.select().from(verifications).where(eq(verifications.identifier, identifier));
  return rows[0] ?? null;
}

async function clearOtps(phone: string) {
  await db.delete(verifications).where(eq(verifications.identifier, phone));
}

async function signUpWithOtp(phoneRaw: string): Promise<{ id: string; phone: string }> {
  const phone = normalizePhoneNumber(phoneRaw);
  assert.ok(phone);
  const sent = await callAuth('/phone-signup/send-otp', jsonInit({ phoneNumber: phone }));
  await readJson(sent, 'signup send-otp', 200);
  const code = await waitForCode(phone, 'signup');
  const res = await callAuth(
    '/phone-signup',
    jsonInit({ phoneNumber: phone, password: PASSWORD, name: 'OTP User', code }),
  );
  const body = await readJson(res, 'phone-signup', 200);
  assert.ok(body.user?.id);
  return { id: body.user.id, phone };
}

test('L1: 未注册号发码静默 200,不产生验证码行也不写 capture(D1 防烧钱)', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping integration test');
    return;
  }
  const phone = localPhone();
  try {
    const res = await callAuth('/phone-number/send-otp', jsonInit({ phoneNumber: `+86 ${phone.slice(0, 3)} ${phone.slice(3)}` }));
    const body = await readJson(res, 'send-otp unregistered', 200);
    assert.equal(body.message, 'code sent', 'must look identical to the plugin success body');
    assert.equal(await verificationRow(phone), null, 'no verification row for unregistered numbers');
    assert.equal(captureRows(phone).length, 0, 'no capture row => no SMS in aliyun mode');
  } finally {
    await clearOtps(phone);
  }
});

test('L2: 已注册号发码 → capture 行 + verification 行;同号 60s 内二连发 429', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping integration test');
    return;
  }
  const created = await signUpWithOtp(localPhone());
  try {
    const first = await callAuth('/phone-number/send-otp', jsonInit({ phoneNumber: created.phone }));
    await readJson(first, 'send-otp registered', 200);
    const code = await waitForCode(created.phone, 'login');
    assert.match(code, /^\d{6}$/);
    const row = await verificationRow(created.phone);
    assert.ok(row, 'plugin stores the OTP under identifier=normalized phone');
    assert.match(row.value, /^\d{6}:0$/);

    const second = await callAuth('/phone-number/send-otp', jsonInit({ phoneNumber: created.phone }));
    assert.equal(second.status, 429, 'per-phone 60s window must throttle the second send');
    await readJson(second, 'send-otp within 60s');
  } finally {
    await clearOtps(created.phone);
    await cleanupUser(created.id);
  }
});

test('L3: 验码登录置 phoneNumberVerified=true 并种会话;游客并号走 /phone-number/verify', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping integration test');
    return;
  }
  // 先无匿名 cookie 建正式号(覆盖 R4:无匿名 session 不误触发并号)。
  const created = await signUpWithOtp(localPhone());
  // 注册即 verified(D3)—— 这里翻回 false 模拟免验证期存量号,验证验码登录会洗回 true。
  await db.update(users).set({ phoneNumberVerified: false }).where(eq(users.id, created.id));

  // 游客建号 + 相册,再走验证码登录。
  const anonRes = await callAuth('/sign-in/anonymous', jsonInit({}));
  const anon = await readJson(anonRes, 'anonymous sign-in', 200);
  const anonCookie = cookieHeaderFrom(anonRes);
  const album = await makeAlbum(anon.user!.id, { title: 'OTP Login Guest Book' });
  try {
    const sendRes = await callAuth('/phone-number/send-otp', jsonInit({ phoneNumber: created.phone }));
    await readJson(sendRes, 'send-otp', 200);
    const code = await waitForCode(created.phone, 'login');

    const verify = await callAuth(
      '/phone-number/verify',
      jsonInit({ phoneNumber: `+86${created.phone}`, code }, anonCookie),
    );
    const verified = await readJson(verify, 'verify login', 200);
    assert.equal(verified.user?.id, created.id);
    assert.ok(cookieHeaderFrom(verify).includes('better-auth.session'), 'verify must set a session cookie');

    const after = await userByPhone(created.phone);
    assert.equal(after?.phoneNumberVerified, true, 'OTP login must mark the phone verified');

    const moved = await albumRepo.findById(album.id);
    assert.equal(moved?.userId, created.id, 'guest album must be transferred on OTP login');
    const anonRow = await db.select().from(users).where(eq(users.id, anon.user!.id));
    assert.equal(anonRow.length, 0, 'anonymous user row must be deleted after the merge');
    assert.equal(await verificationRow(created.phone), null, 'verify consumes the OTP row');
  } finally {
    await clearOtps(created.phone);
    await cleanupUser(created.id);
    await cleanupUser(anon.user!.id);
  }
});

test('L4: 错码 400 INVALID_OTP;未注册号验码 400 OTP_NOT_FOUND(前端引导注册的信号)', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping integration test');
    return;
  }
  const created = await signUpWithOtp(localPhone());
  const stranger = localPhone();
  try {
    const sendRes = await callAuth('/phone-number/send-otp', jsonInit({ phoneNumber: created.phone }));
    await readJson(sendRes, 'send-otp', 200);
    await waitForCode(created.phone, 'login');

    const bad = await callAuth('/phone-number/verify', jsonInit({ phoneNumber: created.phone, code: '000000' }));
    const badBody = await readJson(bad, 'verify wrong code');
    assert.equal(bad.status, 400);
    assert.equal(badBody.code, 'INVALID_OTP');

    const noRow = await callAuth('/phone-number/verify', jsonInit({ phoneNumber: stranger, code: '000000' }));
    const noRowBody = await readJson(noRow, 'verify never-sent code');
    assert.equal(noRow.status, 400);
    assert.equal(noRowBody.code, 'OTP_NOT_FOUND');
  } finally {
    await clearOtps(created.phone);
    await clearOtps(stranger);
    await cleanupUser(created.id);
  }
});

test('S1: 注册发码只对未注册号下发;已注册号静默 200 无 capture 行', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping integration test');
    return;
  }
  const created = await signUpWithOtp(localPhone());
  try {
    const res = await callAuth('/phone-signup/send-otp', jsonInit({ phoneNumber: created.phone }));
    await readJson(res, 'signup send-otp registered', 200);
    const rows = captureRows(created.phone).filter((row) => row.scene === 'signup');
    assert.equal(rows.length, 1, 'only the original signup code; the registered-phone send is silent');
  } finally {
    await clearOtps(created.phone);
    await cleanupUser(created.id);
  }
});

test('S2: 漏 code / 错 code 都建不了号;对 code 建号即 phoneNumberVerified=true(D3)', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping integration test');
    return;
  }
  const phone = localPhone();
  try {
    // 漏 code:zod schema 直接 400(免验证期旧客户端形态)。
    const noCode = await callAuth('/phone-signup', jsonInit({ phoneNumber: phone, password: PASSWORD }));
    assert.equal(noCode.status, 400);

    const sent = await callAuth('/phone-signup/send-otp', jsonInit({ phoneNumber: phone }));
    await readJson(sent, 'signup send-otp', 200);
    await waitForCode(phone, 'signup');

    // 错 code:验码失败 400,不建号。
    const bad = await callAuth(
      '/phone-signup',
      jsonInit({ phoneNumber: phone, password: PASSWORD, code: '000000' }),
    );
    const badBody = await readJson(bad, 'signup wrong code');
    assert.equal(bad.status, 400);
    assert.equal(badBody.code, 'INVALID_OTP');
    assert.equal(await userByPhone(phone), null, 'wrong code must not create a user');

    // 对 code:建号即 verified,注册发码行被消费。
    const code = await waitForCode(phone, 'signup');
    const ok = await callAuth(
      '/phone-signup',
      jsonInit({ phoneNumber: phone, password: PASSWORD, name: 'S2', code }),
    );
    const okBody = await readJson(ok, 'signup with code', 200);
    const user = await userByPhone(phone);
    assert.equal(user?.id, okBody.user?.id);
    assert.equal(user?.phoneNumberVerified, true, 'signup via OTP must mark the phone verified');
    assert.equal(await verificationRow(phone), null, 'signup consumes the OTP row');
  } finally {
    await clearOtps(phone);
    const user = await userByPhone(phone);
    if (user) await cleanupUser(user.id);
  }
});

test('S3: 注册发码与登录发码共享同号 60s 窗口(换端点绕不过限频)', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping integration test');
    return;
  }
  const phone = localPhone();
  try {
    const signupSend = await callAuth('/phone-signup/send-otp', jsonInit({ phoneNumber: phone }));
    await readJson(signupSend, 'signup send-otp', 200);
    // 同号立刻改走登录发码端点(该号未注册会被 D1 短路,但 60s 窗口先行)。
    const loginSend = await callAuth('/phone-number/send-otp', jsonInit({ phoneNumber: phone }));
    assert.equal(loginSend.status, 429, 'shared 60s window must throttle across both send endpoints');
  } finally {
    await clearOtps(phone);
  }
});
