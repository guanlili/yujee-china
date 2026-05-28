import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../db/client';
import { albumRepo } from '../../db/repos/album-repo';
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
