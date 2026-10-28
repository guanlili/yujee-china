import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { users } from '@/db/schema';
import { albumRepo } from '@/db/repos/album-repo';
import { cleanupUser, isDbReachable, makeAlbum } from '@/db/repos/__test__/setup';
import { env } from '@/lib/env';
import { getAuth } from './better-auth';
import { normalizePhoneNumber } from './phone';

// 手机号注册/登录的游客并号(R1–R5):直接驱动真实 better-auth handler,连 after-hook
// 一起验,不 mock。请求形态对齐浏览器:JSON POST + origin 头(带 cookie 时 better-auth
// 强制 CSRF origin 校验)+ 上一响应的 set-cookie 回放。
const BASE = 'http://localhost:3000'; // LOCAL_TRUSTED_ORIGINS 成员

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
  // better-call 的 Request 形参类型与 DOM Request 有出入,运行时完全兼容,双向 cast。
  const res = await getAuth().handler(new Request(`${BASE}/api/auth${path}`, init) as never);
  return res as unknown as Response;
}

function cookieHeaderFrom(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
}

let phoneSeq = 0;

// Date.now() 尾数 + 序号保证多场景间手机号不撞;+86 输入形态,归一后为大陆
// 11 位裸号(138 + 8 位)。
function uniquePhone(): string {
  phoneSeq += 1;
  return `+86138${String(Date.now()).slice(-7)}${phoneSeq % 10}`;
}

// 注册强制 OTP(D3,2026-10-28 起):capture 模式下验证码落 EMAIL_CAPTURE_FILE。
async function signupCodeFor(phoneInput: string): Promise<string> {
  const phone = normalizePhoneNumber(phoneInput);
  assert.ok(phone);
  const sent = await callAuth('/phone-signup/send-otp', jsonInit({ phoneNumber: phone }));
  const text = await sent.text();
  assert.equal(sent.status, 200, `signup send-otp -> ${sent.status}: ${text}`);
  const capturePath = resolve(process.cwd(), env.EMAIL_CAPTURE_FILE);
  for (let i = 0; i < 20; i++) {
    const rows = readFileSync(capturePath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { kind?: string; scene?: string; phoneNumber?: string; code?: string })
      .filter((row) => row.phoneNumber === phone && row.kind === 'phone-otp' && row.scene === 'signup');
    const code = rows.at(-1)?.code;
    if (code) return code;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  assert.fail(`no signup otp capture row for ${phone}`);
}

interface AuthJson {
  user: { id: string };
  [key: string]: unknown;
}

// body 只读一次:assert 消息里内联 await res.text()/res.json() 会把流提前消费,
// 成功路径的 res.json() 就会炸 "Body has already been read"。
async function readJson(res: Response, what: string, expectStatus: number) {
  const text = await res.text();
  assert.equal(res.status, expectStatus, `${what} -> ${res.status}: ${text}`);
  return JSON.parse(text || '{}') as AuthJson;
}

async function createAnonSession(): Promise<{ cookie: string; userId: string }> {
  const res = await callAuth('/sign-in/anonymous', jsonInit({}));
  const body = await readJson(res, 'anonymous sign-in', 200);
  assert.ok(body.user?.id, 'anonymous sign-in must return a user');
  return { cookie: cookieHeaderFrom(res), userId: body.user.id };
}

async function userRow(userId: string) {
  const rows = await db.select().from(users).where(eq(users.id, userId));
  return rows[0] ?? null;
}

test('R1: 未注册手机号 /phone-signup → 游客相册过户 + 匿名号删除', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping integration test');
    return;
  }
  const anon = await createAnonSession();
  const album = await makeAlbum(anon.userId, { title: 'R1 Guest Book' });
  const phone = uniquePhone();
  try {
    const res = await callAuth(
      '/phone-signup',
      jsonInit({ phoneNumber: phone, password: 'password123', name: 'R1 用户', code: await signupCodeFor(phone) }, anon.cookie),
    );
    const body = await readJson(res, 'phone-signup', 200);

    const moved = await albumRepo.findById(album.id);
    assert.equal(moved?.userId, body.user.id, 'album must be transferred to the new phone account');
    assert.notEqual(body.user.id, anon.userId);

    assert.equal(await userRow(anon.userId), null, 'anonymous user row must be deleted');
    await cleanupUser(body.user.id);
  } finally {
    await cleanupUser(anon.userId);
  }
});

test('R2: 已注册手机号 /sign-in/phone-number 登录 → 过户到已有正式号', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping integration test');
    return;
  }
  // 先用无匿名 cookie 的注册建正式号 —— 顺带覆盖 R4:无匿名 session 不误触发并号。
  const phone = uniquePhone();
  const signUp = await callAuth('/phone-signup', jsonInit({ phoneNumber: phone, password: 'password123', code: await signupCodeFor(phone) }));
  const realUserId = (await readJson(signUp, 'phone-signup', 200)).user.id;

  const anon = await createAnonSession();
  const album = await makeAlbum(anon.userId, { title: 'R2 Guest Book' });
  try {
    const res = await callAuth(
      '/sign-in/phone-number',
      jsonInit({ phoneNumber: phone, password: 'password123' }, anon.cookie),
    );
    await readJson(res, 'phone login', 200);

    const moved = await albumRepo.findById(album.id);
    assert.equal(moved?.userId, realUserId, 'album must be transferred to the existing account');

    // Q1 幂等:显式 hook(user 级先跑)过户+删行后,anonymous 插件的 after-hook 还会
    // 从 cookie 缓存再触发一次 onLinkAccount —— 实查闸必须让它 no-op,相册恰好一次
    // 落到正式号、匿名行恰好删一次(删两次也只会是 0 行,这里钉住最终态)。
    assert.equal(await userRow(anon.userId), null, 'anonymous user row must be deleted');
  } finally {
    await cleanupUser(realUserId);
    await cleanupUser(anon.userId);
  }
});

test('R3: 已注册号误走注册 → PHONE_ALREADY_REGISTERED,不过户不删匿名号', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping integration test');
    return;
  }
  const phone = uniquePhone();
  const signUp = await callAuth('/phone-signup', jsonInit({ phoneNumber: phone, password: 'password123', code: await signupCodeFor(phone) }));
  const realUserId = (await readJson(signUp, 'phone-signup', 200)).user.id;

  const anon = await createAnonSession();
  const album = await makeAlbum(anon.userId, { title: 'R3 Guest Book' });
  try {
    const res = await callAuth(
      '/phone-signup',
      // 已注册号的发码被静默短路(不发码);冲突预检在验码之前,code 只需过 schema。
      jsonInit({ phoneNumber: phone, password: 'password123', code: '000000' }, anon.cookie),
    );
    const body = (await readJson(res, 'duplicate phone-signup', 400)) as { code?: string };
    assert.equal(body.code, 'PHONE_ALREADY_REGISTERED');

    const untouched = await albumRepo.findById(album.id);
    assert.equal(untouched?.userId, anon.userId, 'conflict must not transfer anything');
    assert.ok(await userRow(anon.userId), 'conflict must not delete the anonymous user');
  } finally {
    await cleanupUser(realUserId);
    await cleanupUser(anon.userId);
  }
});

test('R5: 无业务数据的空游客 → transfer 空仍成功,匿名号照删', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping integration test');
    return;
  }
  const anon = await createAnonSession();
  const phone = uniquePhone();
  try {
    const res = await callAuth(
      '/phone-signup',
      jsonInit({ phoneNumber: phone, password: 'password123', code: await signupCodeFor(phone) }, anon.cookie),
    );
    const body = await readJson(res, 'phone-signup', 200);
    assert.equal(await userRow(anon.userId), null, 'empty anonymous user must still be deleted');
    await cleanupUser(body.user.id);
  } finally {
    await cleanupUser(anon.userId);
  }
});
