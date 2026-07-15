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

// 排版续跑止血:findLatestLayoutByAlbum 取某 album 最近一条 layout job,不限 status
// (含 FAILED/COMPLETED)—— 与只取 QUEUED/RUNNING 的 findActiveLayoutByAlbum 互补,
// getStoryProgress 据此把 layoutState 判为 'failed',ChatPanel 重进即自动重排。
test('agentJobRepo.findLatestLayoutByAlbum: latest layout job regardless of status; undefined when none', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping repo integration test');
    return;
  }
  const user = await makeUser('latest-layout');
  try {
    const album = await makeAlbum(user.id);

    // 无 layout job → undefined。
    assert.equal(await agentJobRepo.findLatestLayoutByAlbum(album.id), undefined);

    // 非 layout job(init)不该被当成排版 job 返回。
    await agentJobRepo.create(db, {
      userId: user.id,
      albumId: album.id,
      requestId: `init-${Date.now()}`,
      kind: 'init',
      status: 'COMPLETED',
      progress: 100,
    });
    assert.equal(await agentJobRepo.findLatestLayoutByAlbum(album.id), undefined);

    // 建一个 FAILED layout job → 能查到(不限 status,这正是与 findActiveLayoutByAlbum 的差别)。
    const failed = await agentJobRepo.create(db, {
      userId: user.id,
      albumId: album.id,
      requestId: `layout-fail-${Date.now()}`,
      kind: 'layout',
      status: 'FAILED',
      progress: 0,
    });
    // 显式把它的 createdAt 挪到过去,让后面的排序断言与 id 随机破平无关(确定性)。
    await agentJobRepo.update(db, failed.id, { createdAt: new Date(Date.now() - 60 * 1000) });
    const found = await agentJobRepo.findLatestLayoutByAlbum(album.id);
    assert.equal(found?.id, failed.id);
    assert.equal(found?.status, 'FAILED');
    assert.equal(found?.kind, 'layout');

    // 更晚创建的 layout job 胜出(createdAt desc)。
    const newer = await agentJobRepo.create(db, {
      userId: user.id,
      albumId: album.id,
      requestId: `layout-new-${Date.now()}`,
      kind: 'layout',
      status: 'QUEUED',
      progress: 0,
    });
    assert.equal((await agentJobRepo.findLatestLayoutByAlbum(album.id))?.id, newer.id);
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
