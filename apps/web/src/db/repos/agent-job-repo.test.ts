import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentJobRepo } from './agent-job-repo';
import { cleanupUser, isDbReachable, makeAlbum, makeUser } from './__test__/setup';
import { db } from '../client';

test('agentJobRepo: create + findByRequestId + findStaleRunning + update', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping repo integration test');
    return;
  }
  const user = await makeUser('job');
  try {
    const album = await makeAlbum(user.id);
    const requestId = `req-${Date.now()}`;

    const job = await agentJobRepo.create(db, {
      userId: user.id,
      albumId: album.id,
      requestId,
      status: 'QUEUED',
      progress: 0,
    });

    const fetched = await agentJobRepo.findByRequestId(requestId);
    assert.equal(fetched?.id, job.id);
    assert.equal(fetched?.status, 'QUEUED');

    const stalePast = new Date(Date.now() - 60 * 60 * 1000);
    await agentJobRepo.update(db, job.id, { status: 'RUNNING', startedAt: stalePast });

    const stale = await agentJobRepo.findStaleRunning(new Date(Date.now() - 30 * 60 * 1000));
    assert.ok(stale.some((j) => j.id === job.id));
  } finally {
    await cleanupUser(user.id);
  }
});

test('agentJobRepo.transitionStatus: only the first transition off RUNNING wins', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping repo integration test');
    return;
  }
  const user = await makeUser('job-transition');
  try {
    const album = await makeAlbum(user.id);
    const job = await agentJobRepo.create(db, {
      userId: user.id,
      albumId: album.id,
      requestId: `req-tr-${Date.now()}`,
      status: 'RUNNING',
      progress: 0,
    });

    // First transition off RUNNING wins.
    const first = await agentJobRepo.transitionStatus(db, job.id, 'COMPLETED', ['QUEUED', 'RUNNING']);
    assert.equal(first, true);
    assert.equal((await agentJobRepo.findByRequestId(job.requestId))?.status, 'COMPLETED');

    // A racing FAILED transition now loses — status must not be clobbered.
    const second = await agentJobRepo.transitionStatus(db, job.id, 'FAILED', ['QUEUED', 'RUNNING']);
    assert.equal(second, false);
    assert.equal((await agentJobRepo.findByRequestId(job.requestId))?.status, 'COMPLETED');
  } finally {
    await cleanupUser(user.id);
  }
});
