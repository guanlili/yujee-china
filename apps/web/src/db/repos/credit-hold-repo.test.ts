import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creditHoldRepo } from './credit-hold-repo';
import { cleanupUser, isDbReachable, makeAlbum, makeUser } from './__test__/setup';
import { db } from '../client';

test('creditHoldRepo: create + findById + update', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping repo integration test');
    return;
  }
  const user = await makeUser('hold');
  try {
    const album = await makeAlbum(user.id);

    const hold = await creditHoldRepo.create(db, {
      userId: user.id,
      albumId: album.id,
      amount: 10,
      status: 'HOLDING',
    });

    const fetched = await creditHoldRepo.findById(hold.id);
    assert.equal(fetched?.id, hold.id);
    assert.equal(fetched?.amount, 10);

    await creditHoldRepo.update(db, hold.id, { status: 'SETTLED', settledAt: new Date() });
    const after = await creditHoldRepo.findById(hold.id);
    assert.equal(after?.status, 'SETTLED');
    assert.ok(after?.settledAt);
  } finally {
    await cleanupUser(user.id);
  }
});
