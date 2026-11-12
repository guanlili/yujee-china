import { test } from 'node:test';
import assert from 'node:assert/strict';

import { billingService } from './billing-service';
import { creditService } from '../credit/credit-service';
import { customerRepo } from '@/db/repos/customer-repo';
import { cleanupUser, isDbReachable, makeUser } from '@/db/repos/__test__/setup';
import { db } from '@/db/client';

/* billingService.getOverview:仪表盘的只读计费汇总(#97 之后无订阅,全员 free,
   购买史由 PURCHASE 行的 meta 重建 —— meta 是 Creem webhook 写入的,字段形状
   没有 schema 保证,读侧的类型收窄(amount_cents 只认 number 等)必须守住)。 */

test('getOverview: 余额/planId=free/providers/购买史按 PURCHASE 行重建,非购买行不混入', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping integration test');
    return;
  }
  const user = await makeUser('billing-overview');
  try {
    await db.transaction(async (tx) => {
      await creditService.applyDelta(tx, user.id, 60, 'PURCHASE', {
        externalEventId: 'evt_ov_1',
        meta: { provider: 'creem', amount_cents: 990, pack_id: 'starter' },
      });
      await creditService.applyDelta(tx, user.id, -5, 'IMAGE_GEN_CHARGE', {});
      await creditService.applyDelta(tx, user.id, 10, 'SIGNUP_BONUS', {});
      await customerRepo.create(tx, {
        userId: user.id,
        provider: 'creem',
        externalCustomerId: 'cus_test_1',
      });
    });

    const overview = await billingService.getOverview(user.id);
    assert.equal(overview.balance, 165, '100 + 60 - 5 + 10');
    assert.equal(overview.planId, 'free', '#97 之后无订阅,写死 free');
    assert.deepEqual(overview.providers, ['creem']);

    assert.equal(overview.purchases.length, 1, '只重建 PURCHASE 行,签到/消费行不进购买史');
    const [p] = overview.purchases;
    assert.equal(p?.credits, 60);
    assert.equal(p?.amountCents, 990);
    assert.equal(p?.provider, 'creem');
    assert.equal(p?.packId, 'starter');
    assert.ok(p?.id && p?.createdAt);
  } finally {
    await cleanupUser(user.id);
  }
});

test('getOverview: PURCHASE 行缺 meta 字段时类型收窄为 null,不抛错', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping integration test');
    return;
  }
  const user = await makeUser('billing-degraded');
  try {
    // webhook 写坏/漏写的防御:meta 缺 amount_cents / provider / pack_id 不炸。
    await db.transaction(async (tx) => {
      await creditService.applyDelta(tx, user.id, 60, 'PURCHASE', {});
    });

    const overview = await billingService.getOverview(user.id);
    assert.equal(overview.purchases.length, 1);
    const [p] = overview.purchases;
    assert.equal(p?.amountCents, null);
    assert.equal(p?.provider, null);
    assert.equal(p?.packId, null);
    assert.equal(p?.credits, 60, 'delta 恒在,不受 meta 影响');
  } finally {
    await cleanupUser(user.id);
  }
});

test('getOverview: 未知用户 401', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping integration test');
    return;
  }
  await assert.rejects(
    billingService.getOverview('00000000-0000-0000-0000-000000000000'),
    (e: unknown) => (e as { code?: string }).code === 'UNAUTHORIZED',
  );
});
