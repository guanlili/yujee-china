import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { users } from '../../db/schema';
import { albumRepo } from '../../db/repos/album-repo';
import { creditHoldRepo } from '../../db/repos/credit-hold-repo';
import { creditLedgerRepo } from '../../db/repos/credit-ledger-repo';
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

// ── 幂等与对账(下方为 2026-11-13 补的差集) ────────────────────────────────
// settle/release 的条件状态迁移是「回调竞态不双扣/不双记」的唯一防线,sweep + cron +
// webhook 任何两路并发都可能踩到,必须有守卫钉住。

test('creditService.settle: 重复回调幂等 —— 恰好一笔负行,不双扣', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping credit-service integration test');
    return;
  }
  const user = await makeUser('credit-settle-idem');
  try {
    const album = await makeAlbumFor(user.id, 'S');
    await db.transaction(async (tx) => {
      await creditService.hold(tx, user.id, 40, album);
    });
    const holdId = (await albumRepo.findById(album))!.creditHoldId!;

    await db.transaction(async (tx) => {
      await creditService.settle(tx, user.id, holdId);
    });
    assert.equal(await creditService.getBalance(user.id), 60);

    // webhook 重放/sweep 再跑一次:不能再扣,不能再记账。
    await db.transaction(async (tx) => {
      await creditService.settle(tx, user.id, holdId);
    });
    assert.equal(await creditService.getBalance(user.id), 60, '重复 settle 不双扣');

    const settleRows = (await creditLedgerRepo.findByUser(user.id, 20)).filter(
      (r) => r.reason === 'GENERATION_SETTLE',
    );
    assert.equal(settleRows.length, 1, '只有一笔 GENERATION_SETTLE 行');
    assert.equal(settleRows[0]!.delta, -40);
    assert.equal(settleRows[0]!.balanceAfter, 60, 'balanceAfter 与真实余额对账');
    // 不存在的 hold:静默 no-op(幂等语义的一部分)。
    await db.transaction(async (tx) => {
      await creditService.settle(tx, user.id, '00000000-0000-0000-0000-000000000000');
    });
  } finally {
    await cleanupUser(user.id);
  }
});

test('creditService.release: 并发重复释放只写一笔面包屑,不动余额', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping credit-service integration test');
    return;
  }
  const user = await makeUser('credit-release-idem');
  try {
    const album = await makeAlbumFor(user.id, 'R');
    await db.transaction(async (tx) => {
      await creditService.hold(tx, user.id, 25, album);
    });
    const holdId = (await albumRepo.findById(album))!.creditHoldId!;

    await db.transaction(async (tx) => {
      await creditService.release(tx, holdId);
    });
    await db.transaction(async (tx) => {
      await creditService.release(tx, holdId);
    });
    assert.equal(await creditService.getBalance(user.id), 100, 'release 永不动余额');
    assert.equal(await creditService.availableBalance(user.id), 100, '预留解除,可用恢复');
    assert.equal((await creditHoldRepo.findById(holdId))?.status, 'RELEASED');

    const crumbs = (await creditLedgerRepo.findByUser(user.id, 20)).filter(
      (r) => r.reason === 'GENERATION_RELEASE',
    );
    assert.equal(crumbs.length, 1, 'GENERATION_RELEASE 面包屑只写一次');
    assert.equal(crumbs[0]!.delta, 0);
  } finally {
    await cleanupUser(user.id);
  }
});

test('creditService.applyDelta: 每笔变更有账可对;delta=0 落当前值;externalEventId 进 meta;未知用户 401', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping credit-service integration test');
    return;
  }
  const user = await makeUser('credit-applydelta');
  try {
    await db.transaction(async (tx) => {
      await creditService.applyDelta(tx, user.id, 50, 'ADMIN_ADJUST', { meta: { note: 't' } });
      await creditService.applyDelta(tx, user.id, -20, 'IMAGE_GEN_CHARGE', {});
      await creditService.applyDelta(tx, user.id, 0, 'GENERATION_HOLD', {});
      await creditService.applyDelta(tx, user.id, 30, 'PURCHASE', {
        externalEventId: 'evt_apply_1',
        meta: { provider: 'creem' },
      });
    });
    assert.equal(await creditService.getBalance(user.id), 160, '50 - 20 + 0 + 30');

    const ledger = await creditLedgerRepo.findByUser(user.id, 10);
    assert.equal(ledger.length, 4, '四笔变更四笔账,不多不少');
    const byReason = new Map(ledger.map((r) => [r.reason, r]));
    assert.equal(byReason.get('ADMIN_ADJUST')?.balanceAfter, 150);
    assert.equal(byReason.get('IMAGE_GEN_CHARGE')?.balanceAfter, 130);
    // delta=0 也必须有账行(审计面包屑),balanceAfter 是读出来的当前值。
    const zero = byReason.get('GENERATION_HOLD');
    assert.equal(zero?.balanceAfter, 130);
    assert.equal(zero?.meta, null, '无 meta 时落 null 而不是 {}');
    const purchase = byReason.get('PURCHASE');
    assert.equal(purchase?.balanceAfter, 160);
    assert.equal((purchase?.meta as Record<string, unknown>)?.external_event_id, 'evt_apply_1');
    assert.equal((purchase?.meta as Record<string, unknown>)?.provider, 'creem');

    await assert.rejects(
      db.transaction(async (tx) => {
        await creditService.applyDelta(tx, user.id, 1, 'ADMIN_ADJUST');
        await creditService.applyDelta(tx, '00000000-0000-0000-0000-000000000000', 1, 'ADMIN_ADJUST');
      }),
      (e: unknown) => (e as { code?: string }).code === 'UNAUTHORIZED',
      '未知用户 401',
    );
  } finally {
    await cleanupUser(user.id);
  }
});
