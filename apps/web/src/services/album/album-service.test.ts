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
import { albumService } from './album-service';
import { jobService } from '../job/job-service';

// Sets up an AGENT_RUNNING album with a held credit and a RUNNING job whose
// startedAt is `startedAgoMs` in the past. Returns the ids for assertions.
async function runningAlbumWithJob(userId: string, startedAgoMs: number) {
  const album = await makeAlbum(userId);
  const hold = await creditHoldRepo.create(db, {
    userId,
    albumId: album.id,
    amount: 10,
    status: 'HOLDING',
  });
  await albumRepo.update(db, album.id, { creditHoldId: hold.id });
  const job = await agentJobRepo.create(db, {
    userId,
    albumId: album.id,
    requestId: `album-svc-${Date.now()}-${Math.round(startedAgoMs)}`,
    status: 'QUEUED',
    progress: 0,
  });
  await agentJobRepo.update(db, job.id, {
    status: 'RUNNING',
    stage: 'vision',
    progress: 30,
    startedAt: new Date(Date.now() - startedAgoMs),
  });
  return { album, hold, job };
}

test('getDetail: fresh RUNNING job → surfaces live stage/progress, no sweep', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('detail-fresh');
  try {
    const { album, hold } = await runningAlbumWithJob(user.id, 10 * 1000); // started 10s ago

    const detail = await albumService.getDetail(user.id, album.id);

    assert.equal(detail.album.status, 'AGENT_RUNNING');
    assert.deepEqual(detail.generation, { stage: 'vision', progress: 30 });
    const holdAfter = await creditHoldRepo.findById(hold.id);
    assert.equal(holdAfter?.status, 'HOLDING'); // untouched
  } finally {
    await cleanupUser(user.id);
  }
});

test('getDetail: stale RUNNING job → opportunistic sweep to FAILED + credit released', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('detail-stale');
  try {
    const { album, hold, job } = await runningAlbumWithJob(user.id, 60 * 60 * 1000); // 1h ago

    const detail = await albumService.getDetail(user.id, album.id);

    assert.equal(detail.album.status, 'FAILED');
    assert.equal(detail.generation, null);
    assert.match(detail.album.errorMessage ?? '', /timed out/i);

    const jobAfter = await agentJobRepo.findByRequestId(job.requestId);
    assert.equal(jobAfter?.status, 'FAILED');
    const holdAfter = await creditHoldRepo.findById(hold.id);
    assert.equal(holdAfter?.status, 'RELEASED');
  } finally {
    await cleanupUser(user.id);
  }
});

test('getDetail: a job that started long ago but just reported progress is NOT swept (heartbeat)', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('detail-heartbeat');
  try {
    const { album, hold, job } = await runningAlbumWithJob(user.id, 60 * 60 * 1000); // started 1h ago
    // A fresh progress callback refreshes startedAt — the liveness heartbeat.
    await jobService.handleProgress(job.requestId, 'composing', 80);

    const detail = await albumService.getDetail(user.id, album.id);

    assert.equal(detail.album.status, 'AGENT_RUNNING'); // NOT swept despite old start
    assert.deepEqual(detail.generation, { stage: 'composing', progress: 80 });
    const holdAfter = await creditHoldRepo.findById(hold.id);
    assert.equal(holdAfter?.status, 'HOLDING');
  } finally {
    await cleanupUser(user.id);
  }
});

test('sweepStaleJob: re-check under lock declines a job with a fresh heartbeat', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('sweep-recheck');
  try {
    const { album, hold, job } = await runningAlbumWithJob(user.id, 10 * 1000); // fresh: 10s ago

    const res = await jobService.sweepStaleJob(job.id, new Date());

    assert.deepEqual(res, { swept: false, releasedHold: false });
    assert.equal((await albumRepo.findById(album.id))?.status, 'AGENT_RUNNING');
    assert.equal((await creditHoldRepo.findById(hold.id))?.status, 'HOLDING');
  } finally {
    await cleanupUser(user.id);
  }
});

test('listByUser: stale RUNNING album is swept to FAILED on the list path too', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('list-stale');
  try {
    const { album, hold } = await runningAlbumWithJob(user.id, 60 * 60 * 1000);

    const rows = await albumService.listByUser(user.id);
    const row = rows.find((r) => r.id === album.id);
    assert.equal(row?.status, 'FAILED');

    const holdAfter = await creditHoldRepo.findById(hold.id);
    assert.equal(holdAfter?.status, 'RELEASED');
  } finally {
    await cleanupUser(user.id);
  }
});

test('updateTitle: renames an owned album (trimmed)', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('title-rename');
  try {
    const album = await makeAlbum(user.id, { title: 'Old Title' });

    const result = await albumService.updateTitle(user.id, album.id, '  New Title  ');
    assert.equal(result.title, 'New Title');

    const after = await albumRepo.findById(album.id);
    assert.equal(after?.title, 'New Title');
  } finally {
    await cleanupUser(user.id);
  }
});

test('updateTitle: rejects a blank title', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('title-blank');
  try {
    const album = await makeAlbum(user.id, { title: 'Keep Me' });

    await assert.rejects(
      () => albumService.updateTitle(user.id, album.id, '   '),
      (err: { code?: string }) => err.code === 'VALIDATION_FAILED',
    );
    const after = await albumRepo.findById(album.id);
    assert.equal(after?.title, 'Keep Me'); // unchanged
  } finally {
    await cleanupUser(user.id);
  }
});

test('updateTitle: rejects a non-owner with ALBUM_NOT_OWNED', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const owner = await makeUser('title-owner');
  const intruder = await makeUser('title-intruder');
  try {
    const album = await makeAlbum(owner.id, { title: 'Owned' });

    await assert.rejects(
      () => albumService.updateTitle(intruder.id, album.id, 'Hijacked'),
      (err: { code?: string }) => err.code === 'ALBUM_NOT_OWNED',
    );
    const after = await albumRepo.findById(album.id);
    assert.equal(after?.title, 'Owned'); // unchanged
  } finally {
    await cleanupUser(owner.id);
    await cleanupUser(intruder.id);
  }
});
