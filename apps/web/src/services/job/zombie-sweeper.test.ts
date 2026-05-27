import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../db/client';
import { agentJobRepo } from '../../db/repos/agent-job-repo';
import { albumRepo } from '../../db/repos/album-repo';
import { creditHoldRepo } from '../../db/repos/credit-hold-repo';
import {
  cleanupUser,
  isDbReachable,
  makeAlbum,
  makeUser,
} from '../../db/repos/__test__/setup';
import { zombieSweeper } from './zombie-sweeper';

test('zombieSweeper: stale RUNNING job → job/album FAILED + hold RELEASED in one tx', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping zombie-sweeper integration test');
    return;
  }
  const user = await makeUser('sweeper');
  try {
    const album = await makeAlbum(user.id);

    const hold = await creditHoldRepo.create(db, {
      userId: user.id,
      albumId: album.id,
      amount: 10,
      status: 'HOLDING',
    });
    await albumRepo.update(db, album.id, { creditHoldId: hold.id });

    const stalePast = new Date(Date.now() - 60 * 60 * 1000);
    const job = await agentJobRepo.create(db, {
      userId: user.id,
      albumId: album.id,
      requestId: `sweeper-${Date.now()}`,
      status: 'QUEUED',
      progress: 0,
    });
    await agentJobRepo.update(db, job.id, { status: 'RUNNING', startedAt: stalePast });

    const result = await zombieSweeper.sweep('system', { timeoutMs: 30 * 60 * 1000 });
    assert.ok(result.scanned >= 1);
    assert.equal(result.failed, result.scanned);
    assert.equal(result.releasedHolds, 1);

    const reloaded = await agentJobRepo.findByRequestId(job.requestId);
    assert.equal(reloaded?.status, 'FAILED');
    assert.deepEqual(reloaded?.error, {
      code: 'AGENT_TIMEOUT',
      message: 'RUNNING > 1800000ms without callback',
    });

    const albumAfter = await albumRepo.findById(album.id);
    assert.equal(albumAfter?.status, 'FAILED');
    assert.match(albumAfter?.errorMessage ?? '', /timed out/i);

    const holdAfter = await creditHoldRepo.findById(hold.id);
    assert.equal(holdAfter?.status, 'RELEASED');
  } finally {
    await cleanupUser(user.id);
  }
});
