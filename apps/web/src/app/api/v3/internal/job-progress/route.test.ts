import { test } from 'node:test';
import assert from 'node:assert/strict';
import { env } from '@/lib/env';
import { db } from '@/db/client';
import { agentJobRepo } from '@/db/repos/agent-job-repo';
import { albumRepo } from '@/db/repos/album-repo';
import { creditHoldRepo } from '@/db/repos/credit-hold-repo';
import { jobService } from '@/services/job/job-service';
import { cleanupUser, isDbReachable, makeAlbum, makeUser } from '@/db/repos/__test__/setup';
import { POST } from './route';

// End-to-end through the actual v3 callback entrypoint (WP1.1): AGENT_SHARED_SECRET
// auth, V3Callback parse, and dispatch to the right jobService.handleV3* branch.
// The v3 analyze job is stored under kind='init' (no kind migration); the envelope
// carries jobKind='analyze'. docs/agent/v3-requirements.md §8.

// A minimal V3 章节树: one chapter, one photo, accentColor/artFont null placeholders
// (required-nullable keys must survive the wire — the contract bug this WP fixed).
const TREE = {
  chapters: [
    {
      chapterId: 'ch_1',
      description: '',
      accentColor: null,
      artFont: null,
      photos: [
        {
          photoId: 'p1',
          sceneDescription: '',
          width: 800,
          height: 600,
          orientation: 'landscape',
          takenAt: null,
        },
      ],
    },
  ],
};
const PAGES = [{ pageIndex: 0, templateId: 'mag-02', images: { 'cells[0].image': 'p1' }, texts: {} }];
const USAGE = { durationMs: 1, models: {} };

function post(payload: unknown, secret: string = env.AGENT_SHARED_SECRET) {
  return POST(
    new Request('http://web.test/api/v3/internal/job-progress', {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  );
}

async function seed(userId: string) {
  const album = await makeAlbum(userId);
  const hold = await creditHoldRepo.create(db, { userId, albumId: album.id, amount: 10, status: 'HOLDING' });
  await albumRepo.update(db, album.id, { creditHoldId: hold.id });
  const requestId = `v3route-${Date.now()}-${Math.round(performance.now())}`;
  // v3 analyze reuses kind='init'.
  await jobService.createGenerationJob(db, { userId, albumId: album.id, requestId, kind: 'init' });
  return { albumId: album.id, holdId: hold.id, requestId };
}

test('rejects a wrong shared secret with 401', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const res = await post(
    { requestId: 'x', jobKind: 'analyze', event: 'failed', error: { code: 'X', message: 'm' } },
    'wrong',
  );
  assert.equal(res.status, 401);
});

test('unknown requestId → accepted:false, nothing written', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const res = await post({
    requestId: 'no-such-req',
    jobKind: 'analyze',
    event: 'completed',
    tree: TREE,
    usage: USAGE,
  });
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).data, { accepted: false });
});

test('analyze/completed rejects pages because Stage1 is tree-only', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const user = await makeUser('v3route-analyze-pages');
  try {
    const { requestId } = await seed(user.id);
    const res = await post({
      requestId,
      jobKind: 'analyze',
      event: 'completed',
      tree: TREE,
      pages: PAGES,
      usage: USAGE,
    });
    assert.equal(res.status, 400);
  } finally {
    await cleanupUser(user.id);
  }
});

test('analyze/completed tree-only → stores tree progress, keeps init job running and hold open', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const user = await makeUser('v3route-tree-only');
  try {
    const { albumId, holdId, requestId } = await seed(user.id);
    const res = await post({
      requestId,
      jobKind: 'analyze',
      event: 'completed',
      tree: TREE,
      usage: USAGE,
    });
    assert.equal((await res.json()).data.accepted, true);

    const album = await albumRepo.findById(albumId);
    assert.equal(album?.status, 'AGENT_RUNNING');
    assert.deepEqual(album?.draftJson, {
      version: 'v3-story',
      tree: TREE,
      progress: { currentChapterId: 'ch_1', doneChapterIds: [] },
    });
    assert.equal(album?.stage, 'analysing');
    const hold = await creditHoldRepo.findById(holdId);
    assert.equal(hold?.status, 'HOLDING');
    const job = await agentJobRepo.findByRequestId(requestId);
    assert.equal(job?.status, 'RUNNING');
    assert.equal(job?.stage, 'layout');
  } finally {
    await cleanupUser(user.id);
  }
});

test('select-layout/completed → merges pages + EDITING + stage story + hold settled', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const user = await makeUser('v3route-layout-done');
  try {
    const { albumId, holdId, requestId } = await seed(user.id);
    await albumRepo.update(db, albumId, {
      status: 'AGENT_RUNNING',
      stage: 'analysing',
      draftJson: {
        version: 'v3-story',
        tree: TREE,
        progress: { currentChapterId: 'ch_1', doneChapterIds: [] },
      },
    });
    const res = await post({
      requestId,
      jobKind: 'select-layout',
      event: 'completed',
      pages: PAGES,
      usage: USAGE,
    });
    assert.equal((await res.json()).data.accepted, true);

    const album = await albumRepo.findById(albumId);
    assert.equal(album?.status, 'EDITING');
    assert.deepEqual(album?.draftJson, {
      version: 'v3-story',
      tree: TREE,
      pages: PAGES,
      progress: { currentChapterId: 'ch_1', doneChapterIds: [] },
    });
    assert.equal(album?.layoutJson, null);
    assert.equal(album?.stage, 'story');
    const hold = await creditHoldRepo.findById(holdId);
    assert.equal(hold?.status, 'SETTLED');
    const job = await agentJobRepo.findByRequestId(requestId);
    assert.equal(job?.status, 'COMPLETED');
  } finally {
    await cleanupUser(user.id);
  }
});

test('analyze/failed → album FAILED + hold released, stage untouched (失败可重试不污染 stage)', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const user = await makeUser('v3route-fail');
  try {
    const { albumId, holdId, requestId } = await seed(user.id);
    const res = await post({
      requestId,
      jobKind: 'analyze',
      event: 'failed',
      error: { code: 'AGENT_VISION_FAILED', message: 'boom' },
      stage: 'describe',
    });
    assert.equal((await res.json()).data.accepted, true);

    const album = await albumRepo.findById(albumId);
    assert.equal(album?.status, 'FAILED');
    assert.equal(album?.stage, 'analysing'); // never advanced
    const hold = await creditHoldRepo.findById(holdId);
    assert.equal(hold?.status, 'RELEASED');
    const job = await agentJobRepo.findByRequestId(requestId);
    assert.equal(job?.status, 'FAILED');
  } finally {
    await cleanupUser(user.id);
  }
});

test('analyze/progress advances job stage/progress, album stays running', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const user = await makeUser('v3route-prog');
  try {
    const { albumId, requestId } = await seed(user.id);
    const res = await post({
      requestId,
      jobKind: 'analyze',
      event: 'progress',
      stage: 'template',
      progress: 50,
    });
    assert.equal((await res.json()).data.accepted, true);

    const job = await agentJobRepo.findByRequestId(requestId);
    assert.equal(job?.status, 'RUNNING');
    assert.equal(job?.stage, 'template');
    assert.equal(job?.progress, 50);
    const album = await albumRepo.findById(albumId);
    assert.equal(album?.status, 'AGENT_RUNNING');
  } finally {
    await cleanupUser(user.id);
  }
});

test('rejects lat/lng leaking into a callback tree (defence in depth)', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const user = await makeUser('v3route-gps');
  try {
    const { requestId } = await seed(user.id);
    const badTree = {
      chapters: [
        {
          chapterId: 'ch_1',
          description: '',
          accentColor: null,
          artFont: null,
          photos: [
            {
              photoId: 'p1',
              sceneDescription: '',
              width: 800,
              height: 600,
              orientation: 'landscape',
              takenAt: null,
              lat: 35.0, // §3 privacy: strict schema must reject this key
            },
          ],
        },
      ],
    };
    const res = await post({
      requestId,
      jobKind: 'analyze',
      event: 'completed',
      tree: badTree,
      pages: PAGES,
      usage: USAGE,
    });
    // V3Callback.strict() rejects the unknown key → VALIDATION_FAILED (400).
    assert.equal(res.status, 400);
  } finally {
    await cleanupUser(user.id);
  }
});
