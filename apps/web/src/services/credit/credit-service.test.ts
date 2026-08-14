import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { users } from '../../db/schema';
import { albumRepo } from '../../db/repos/album-repo';
import { cleanupUser, isDbReachable, makeUser } from '../../db/repos/__test__/setup';
import { creditService } from './credit-service';

// 2026-08-14 生产真实事故:出现余额为负的用户。根因是三处生成通道共用的形状:
//   precheck(只读 users.credit_balance)→ hold(0 扣减的预留)→ 几分钟后 settle(无条件扣)
// 预检不认在途 hold —— 第一本书还在生成时开第二本,预检读到的余额与第一本预检时
// 一模一样,两单都放行,先后结算就透支。窗口期 = 整个生成时长,不需要竞态。
// 这里锁的守门规则:**hold 本身**必须在事务里按「余额 - 在途 hold 合计」放行。

async function makeAlbumFor(userId: string, title: string): Promise<string> {
  const album = await albumRepo.create(db, {
    userId,
    title,
    prompt: 'p',
    photoCount: 3,
    status: 'AGENT_RUNNING',
    pageCount: 0,
  });
  return album.id;
}

async function setBalance(userId: string, balance: number): Promise<void> {
  await db.update(users).set({ creditBalance: balance }).where(eq(users.id, userId));
}

test('creditService.hold: 在途 hold 必须占用余额 —— 第二单超出可用额度要被拒', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping credit-service integration test');
    return;
  }
  const user = await makeUser('credit-overdraw');
  try {
    await setBalance(user.id, 30);
    const albumA = await makeAlbumFor(user.id, '第一本');
    const albumB = await makeAlbumFor(user.id, '第二本');

    // 第一单:30 积分,余额正好够 → 放行
    await db.transaction(async (tx) => {
      await creditService.hold(tx, user.id, 30, albumA);
    });

    // 第二单:第一单还没结算(HOLDING),可用额度已是 0 → 必须拒绝。
    // 修复前这里会放行(precheck 和 hold 都只看 credit_balance),这条测试就红。
    await assert.rejects(
      db.transaction(async (tx) => {
        await creditService.hold(tx, user.id, 30, albumB);
      }),
      (e: unknown) => (e as { code?: string }).code === 'CREDIT_INSUFFICIENT',
      '第二个 hold 应因在途预留不足被拒',
    );

    // 第一单正常结算 → 余额恰好归零,不为负
    const holdId = (await albumRepo.findById(albumA))!.creditHoldId!;
    await db.transaction(async (tx) => {
      await creditService.settle(tx, user.id, holdId);
    });
    assert.equal(await creditService.getBalance(user.id), 0);
  } finally {
    await cleanupUser(user.id);
  }
});

test('creditService.hold: 已结算/已释放的 hold 不再占额度', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping credit-service integration test');
    return;
  }
  const user = await makeUser('credit-hold-lifecycle');
  try {
    await setBalance(user.id, 30);
    const albumA = await makeAlbumFor(user.id, 'A');
    const albumB = await makeAlbumFor(user.id, 'B');
    const albumC = await makeAlbumFor(user.id, 'C');

    // A:hold 30 → 失败释放 → 额度应全数回来,B 能开
    await db.transaction(async (tx) => creditService.hold(tx, user.id, 30, albumA));
    const holdA = (await albumRepo.findById(albumA))!.creditHoldId!;
    await db.transaction(async (tx) => creditService.release(tx, holdA));
    await db.transaction(async (tx) => creditService.hold(tx, user.id, 20, albumB));

    // B 结算(余额 30→10、且 B 的 hold 不再在途)后:C 要 10,应放行
    const holdB = (await albumRepo.findById(albumB))!.creditHoldId!;
    await db.transaction(async (tx) => creditService.settle(tx, user.id, holdB));
    await db.transaction(async (tx) => creditService.hold(tx, user.id, 10, albumC));

    // 此刻余额 10、在途 10,再要 1 分都不行
    const albumD = await makeAlbumFor(user.id, 'D');
    await assert.rejects(
      db.transaction(async (tx) => creditService.hold(tx, user.id, 1, albumD)),
      (e: unknown) => (e as { code?: string }).code === 'CREDIT_INSUFFICIENT',
    );
  } finally {
    await cleanupUser(user.id);
  }
});

test('creditService.availableBalance: 余额 - 在途 hold,precheck 与守门同一口径', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping credit-service integration test');
    return;
  }
  const user = await makeUser('credit-available');
  try {
    await setBalance(user.id, 30);
    const albumA = await makeAlbumFor(user.id, 'A');
    await db.transaction(async (tx) => creditService.hold(tx, user.id, 12, albumA));
    assert.equal(await creditService.availableBalance(user.id), 18);
    // precheck 也必须按可用额度算 —— 否则用户传完照片才在 hold 处被打回,体验割裂。
    await assert.rejects(
      creditService.precheck(user.id, 19),
      (e: unknown) => (e as { code?: string }).code === 'CREDIT_INSUFFICIENT',
    );
    await creditService.precheck(user.id, 18); // 不抛
  } finally {
    await cleanupUser(user.id);
  }
});
