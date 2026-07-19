import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { accounts } from '../../db/schema';
import { albumRepo } from '../../db/repos/album-repo';
import { userRepo } from '../../db/repos/user-repo';
import { creditLedgerRepo } from '../../db/repos/credit-ledger-repo';
import { cleanupUser, isDbReachable, makeUser } from '../../db/repos/__test__/setup';
import { adminService } from './admin-service';

const DAY = 24 * 60 * 60 * 1000;

test('adminService.listUsers: returns recent users with album counts', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping admin-service integration test');
    return;
  }
  const user = await makeUser('admin-list');
  try {
    await albumRepo.create(db, {
      userId: user.id,
      title: 'A',
      prompt: 'p',
      photoCount: 3,
      status: 'EDITING',
      pageCount: 0,
    });
    await albumRepo.create(db, {
      userId: user.id,
      title: 'B',
      prompt: 'p',
      photoCount: 3,
      status: 'COMPLETED',
      pageCount: 0,
    });

    const { users } = await adminService.listUsers(user.id, { limit: 100 });
    const row = users.find((u) => u.id === user.id);
    assert.ok(row, 'created user should appear in listUsers');
    assert.equal(row?.albumCount, 2);
    assert.equal(row?.email, user.email);
  } finally {
    await cleanupUser(user.id);
  }
});

test('adminService.cleanupAbandoned: deletes only old FAILED albums', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping admin-service integration test');
    return;
  }
  const user = await makeUser('admin-cleanup');
  try {
    const old = new Date(Date.now() - 60 * DAY);
    const failedOld = await albumRepo.create(db, {
      userId: user.id,
      title: 'old failed',
      prompt: 'p',
      photoCount: 3,
      status: 'FAILED',
      pageCount: 0,
      createdAt: old,
    });
    const failedRecent = await albumRepo.create(db, {
      userId: user.id,
      title: 'recent failed',
      prompt: 'p',
      photoCount: 3,
      status: 'FAILED',
      pageCount: 0,
    });
    const editingOld = await albumRepo.create(db, {
      userId: user.id,
      title: 'old editing',
      prompt: 'p',
      photoCount: 3,
      status: 'EDITING',
      pageCount: 0,
      createdAt: old,
    });

    const res = await adminService.cleanupAbandoned(user.id, { olderThanDays: 30 });
    assert.ok(res.deleted >= 1);

    assert.equal(await albumRepo.findById(failedOld.id), undefined, 'old FAILED purged');
    assert.ok(await albumRepo.findById(failedRecent.id), 'recent FAILED kept');
    assert.ok(await albumRepo.findById(editingOld.id), 'non-FAILED kept');
  } finally {
    await cleanupUser(user.id);
  }
});

test('adminService.grantCredit: rejects bad amounts before any DB work', async () => {
  const email = 'nobody@yujee.test';
  await assert.rejects(() => adminService.grantCredit('actor', { email, amount: 0 }), /non-zero/);
  await assert.rejects(() => adminService.grantCredit('actor', { email, amount: 1.5 }), /non-zero/);
  await assert.rejects(
    () => adminService.grantCredit('actor', { email, amount: 100001 }),
    /magnitude/,
  );
});

test('adminService.grantCredit: unknown email throws USER_NOT_FOUND', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping admin-service integration test');
    return;
  }
  await assert.rejects(
    () => adminService.grantCredit('actor', { email: `missing-${Date.now()}@yujee.test`, amount: 10 }),
    /No user with that email/,
  );
});

test('adminService.grantCredit: adds credits, updates balance, writes ADMIN_ADJUST ledger', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping admin-service integration test');
    return;
  }
  const user = await makeUser('admin-grant'); // starts at creditBalance 100
  try {
    // case-insensitive lookup: pass the address upper-cased
    const res = await adminService.grantCredit(user.id, {
      email: user.email.toUpperCase(),
      amount: 50,
      note: 'welcome bonus',
    });
    assert.equal(res.delta, 50);
    assert.equal(res.balanceAfter, 150);
    assert.equal(res.email, user.email);

    const fresh = await userRepo.findById(user.id);
    assert.equal(fresh?.creditBalance, 150);

    const ledger = await creditLedgerRepo.findByUser(user.id, 10);
    const row = ledger.find((r) => r.reason === 'ADMIN_ADJUST');
    assert.ok(row, 'an ADMIN_ADJUST ledger row should exist');
    assert.equal(row?.delta, 50);
    assert.equal(row?.balanceAfter, 150);
    assert.equal((row?.meta as { actorId?: string } | null)?.actorId, user.id);
  } finally {
    await cleanupUser(user.id);
  }
});

test('adminService.grantCredit: negative amount deducts', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping admin-service integration test');
    return;
  }
  const user = await makeUser('admin-deduct'); // starts at 100
  try {
    const res = await adminService.grantCredit(user.id, { email: user.email, amount: -30 });
    assert.equal(res.delta, -30);
    assert.equal(res.balanceAfter, 70);
    const fresh = await userRepo.findById(user.id);
    assert.equal(fresh?.creditBalance, 70);
  } finally {
    await cleanupUser(user.id);
  }
});

test('adminService.getAnalytics: returns full shape with non-negative totals', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping admin-service integration test');
    return;
  }
  const user = await makeUser('admin-analytics');
  try {
    const data = await adminService.getAnalytics(user.id);

    assert.ok(data.users.total >= 1);
    assert.deepEqual(Object.keys(data.albumsByStatus).sort(), [
      'AGENT_RUNNING',
      'COMPLETED',
      'EDITING',
      'FAILED',
    ]);
    assert.deepEqual(Object.keys(data.jobsByStatus).sort(), [
      'COMPLETED',
      'FAILED',
      'QUEUED',
      'RUNNING',
    ]);
    assert.equal(typeof data.credits.purchased30d, 'number');
    assert.equal(typeof data.credits.consumed30d, 'number');
  } finally {
    await cleanupUser(user.id);
  }
});

test('adminService.createUser: creates a verified user with a credential account', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping admin-service integration test');
    return;
  }
  const actor = await makeUser('admin-create-actor');
  const email = `manual-create-${Date.now()}@yujee.test`;
  let createdId: string | undefined;
  try {
    const res = await adminService.createUser(actor.id, {
      email,
      password: 'supersecret',
      name: 'Manual User',
    });
    createdId = res.id;
    assert.equal(res.email, email);

    const user = await userRepo.findByEmailInsensitive(email);
    assert.ok(user, 'created user should be findable');
    assert.equal(user?.emailVerified, true, 'user must be pre-verified so they can log in');

    const acct = await db.select().from(accounts).where(eq(accounts.userId, user!.id));
    assert.equal(acct.length, 1);
    assert.equal(acct[0]?.providerId, 'credential');
    assert.equal(acct[0]?.accountId, user!.id);
    assert.ok(acct[0]?.password && acct[0].password.length > 0, 'password hash must be stored');

    // Case-insensitive duplicate guard.
    await assert.rejects(
      adminService.createUser(actor.id, { email: email.toUpperCase(), password: 'anotherpass' }),
      /already exists/i,
    );

    // Password policy guard.
    await assert.rejects(
      adminService.createUser(actor.id, { email: `short-${Date.now()}@yujee.test`, password: 'short' }),
      /8/,
    );
  } finally {
    if (createdId) await cleanupUser(createdId);
    await cleanupUser(actor.id);
  }
});
