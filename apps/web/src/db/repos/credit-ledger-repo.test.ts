import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creditLedgerRepo } from './credit-ledger-repo';
import { cleanupUser, isDbReachable, makeUser } from './__test__/setup';
import { db } from '../client';

test('creditLedgerRepo: create + findByUser + sumByUser', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping repo integration test');
    return;
  }
  const user = await makeUser('ledger');
  try {
    await creditLedgerRepo.create(db, {
      userId: user.id,
      delta: 100,
      reason: 'SIGNUP_BONUS',
      balanceAfter: 100,
    });
    await creditLedgerRepo.create(db, {
      userId: user.id,
      delta: -10,
      reason: 'GENERATION_SETTLE',
      balanceAfter: 90,
    });

    const rows = await creditLedgerRepo.findByUser(user.id);
    assert.equal(rows.length, 2);

    const total = await creditLedgerRepo.sumByUser(user.id);
    assert.equal(total, 90);
  } finally {
    await cleanupUser(user.id);
  }
});
