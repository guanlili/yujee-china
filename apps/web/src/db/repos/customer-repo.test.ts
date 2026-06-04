import { test } from 'node:test';
import assert from 'node:assert/strict';
import { customerRepo } from './customer-repo';
import { cleanupUser, isDbReachable, makeUser } from './__test__/setup';
import { db } from '../client';

test('customerRepo: create + findByUserAndProvider + findByProviderExternalId', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping repo integration test');
    return;
  }
  const user = await makeUser('customer');
  try {
    const externalId = `cus_test_${Date.now()}`;
    const cust = await customerRepo.create(db, {
      userId: user.id,
      provider: 'creem',
      externalCustomerId: externalId,
      email: 'cust@yujee.test',
    });

    const byUser = await customerRepo.findByUserAndProvider(user.id, 'creem');
    assert.equal(byUser?.id, cust.id);

    const byExternal = await customerRepo.findByProviderExternalId('creem', externalId);
    assert.equal(byExternal?.userId, user.id);
  } finally {
    await cleanupUser(user.id);
  }
});
