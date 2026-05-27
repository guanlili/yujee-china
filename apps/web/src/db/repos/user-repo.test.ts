import { test } from 'node:test';
import assert from 'node:assert/strict';
import { userRepo } from './user-repo';
import { cleanupUser, isDbReachable, makeUser } from './__test__/setup';
import { db } from '../client';

test('userRepo: upsert + findById + updateCredit', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping repo integration test');
    return;
  }
  const created = await makeUser('user');
  try {
    const fetched = await userRepo.findById(created.id);
    assert.equal(fetched?.id, created.id);
    assert.equal(fetched?.creditBalance, 100);

    await userRepo.updateCredit(db, created.id, -15);
    const after = await userRepo.findById(created.id);
    assert.equal(after?.creditBalance, 85);
  } finally {
    await cleanupUser(created.id);
  }
});
