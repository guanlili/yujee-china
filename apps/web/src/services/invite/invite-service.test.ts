import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { inviteCodes, inviteRedemptions } from '../../db/schema';
import { isDbReachable, makeUser, cleanupUser } from '../../db/repos/__test__/setup';
import { inviteService } from './invite-service';
import { creditService } from '../credit/credit-service';

async function makeCode(
  code: string,
  opts: { credits?: number; expiresAt?: Date; maxRedemptions?: number | null } = {},
) {
  await db.insert(inviteCodes).values({
    code,
    credits: opts.credits ?? 100,
    expiresAt: opts.expiresAt ?? new Date(Date.now() + 86_400_000),
    maxRedemptions: opts.maxRedemptions ?? null,
  });
}
async function dropCode(code: string) {
  const rows = await db.select().from(inviteCodes).where(eq(inviteCodes.code, code));
  for (const r of rows) await db.delete(inviteRedemptions).where(eq(inviteRedemptions.codeId, r.id));
  await db.delete(inviteCodes).where(eq(inviteCodes.code, code));
}
const errCode = (e: unknown) => (e as { code?: string })?.code;

test('redeem: 有效码加积分,余额 += credits;大小写/空白无关', async (t) => {
  if (!(await isDbReachable())) { t.skip('DATABASE_URL is not reachable; skipping'); return; }
  const user = await makeUser('inv-ok');
  const CODE = 'YUJEE-TEST-OK';
  await makeCode(CODE, { credits: 100 });
  try {
    const before = await creditService.getBalance(user.id);
    const r = await inviteService.redeem(user.id, '  yujee-test-ok  '); // 小写+空白也能兑
    assert.equal(r.credits, 100);
    assert.equal(r.balance, before + 100);
    assert.equal(await creditService.getBalance(user.id), before + 100);
    // 兑换记录 + redeemed_count 都 +1
    const [row] = await db.select().from(inviteCodes).where(eq(inviteCodes.code, CODE));
    assert.equal(row!.redeemedCount, 1);
  } finally {
    await cleanupUser(user.id);
    await dropCode(CODE);
  }
});

test('redeem: 同一用户重复兑同一码 → INVITE_CODE_USED', async (t) => {
  if (!(await isDbReachable())) { t.skip('DATABASE_URL is not reachable; skipping'); return; }
  const user = await makeUser('inv-dup');
  const CODE = 'YUJEE-TEST-DUP';
  await makeCode(CODE);
  try {
    await inviteService.redeem(user.id, CODE);
    await assert.rejects(() => inviteService.redeem(user.id, CODE), (e) => errCode(e) === 'INVITE_CODE_USED');
    // 余额只加了一次(makeUser 起始 100 + 100)
    assert.equal(await creditService.getBalance(user.id), 200);
  } finally {
    await cleanupUser(user.id);
    await dropCode(CODE);
  }
});

test('redeem: 过期码 → INVITE_CODE_EXPIRED,不加分', async (t) => {
  if (!(await isDbReachable())) { t.skip('DATABASE_URL is not reachable; skipping'); return; }
  const user = await makeUser('inv-exp');
  const CODE = 'YUJEE-TEST-EXP';
  await makeCode(CODE, { expiresAt: new Date(Date.now() - 1000) });
  try {
    await assert.rejects(() => inviteService.redeem(user.id, CODE), (e) => errCode(e) === 'INVITE_CODE_EXPIRED');
    assert.equal(await creditService.getBalance(user.id), 100); // 未变(makeUser 起始 100)
  } finally {
    await cleanupUser(user.id);
    await dropCode(CODE);
  }
});

test('redeem: 不存在的码 → INVITE_CODE_INVALID', async (t) => {
  if (!(await isDbReachable())) { t.skip('DATABASE_URL is not reachable; skipping'); return; }
  const user = await makeUser('inv-bad');
  try {
    await assert.rejects(() => inviteService.redeem(user.id, 'NOPE-NOPE'), (e) => errCode(e) === 'INVITE_CODE_INVALID');
  } finally {
    await cleanupUser(user.id);
  }
});
