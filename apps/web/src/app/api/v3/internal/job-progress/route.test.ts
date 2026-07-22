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
      chapterContext: '',
      place: '',
      keywords: [],
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


// C 方案:落库页面带烘出的 html;槽位断言剥掉它逐一比对。
function stripPagesHtml(pages: unknown): unknown {
  if (!Array.isArray(pages)) return pages;
  return pages.map((p) => {
    const { html: _html, ...rest } = p as Record<string, unknown>;
    return rest;
  });
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

test('analyze/completed tree-only → stores tree, album EDITING/story, init job COMPLETED, SETTLES hold', async (t) => {
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
    // 解耦:analyze 完成 → 相册直接 EDITING/story(用户由此进采访编辑器),init job COMPLETED。
    assert.deepEqual(album?.draftJson, {
      version: 'v3-story',
      tree: TREE,
      progress: { currentChapterId: 'ch_1', doneChapterIds: [] },
    });
    assert.equal(album?.status, 'EDITING');
    assert.equal(album?.stage, 'story');
    // 扣费时机(用户拍板):analyze 完成 = 相册成形,在此结算 hold。
    const hold = await creditHoldRepo.findById(holdId);
    assert.equal(hold?.status, 'SETTLED');
    const job = await agentJobRepo.findByRequestId(requestId);
    assert.equal(job?.status, 'COMPLETED');
    assert.equal(job?.stage, 'wrap');
    assert.equal(job?.progress, 100);
  } finally {
    await cleanupUser(user.id);
  }
});

test('analyze/completed completes the init job regardless of prior progress', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const user = await makeUser('v3route-analyze-progress-marker');
  try {
    const { requestId } = await seed(user.id);
    await post({
      requestId,
      jobKind: 'analyze',
      event: 'progress',
      stage: 'group',
      progress: 100,
    });

    const res = await post({
      requestId,
      jobKind: 'analyze',
      event: 'completed',
      tree: TREE,
      usage: USAGE,
    });
    assert.equal((await res.json()).data.accepted, true);

    const job = await agentJobRepo.findByRequestId(requestId);
    assert.equal(job?.status, 'COMPLETED');
    assert.equal(job?.stage, 'wrap');
    assert.equal(job?.progress, 100);
  } finally {
    await cleanupUser(user.id);
  }
});

test('select-layout/completed under EDITING (时序反转) → merges pages + stage story + job COMPLETED', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const user = await makeUser('v3route-layout-done');
  try {
    const { albumId, holdId, requestId } = await seed(user.id);
    // 时序反转:收集完才排版,排版期 album 恒为 EDITING(不再 AGENT_RUNNING)。这是回归本 bug
    // 的核心用例 —— 完成回调必须在 EDITING 下也接受(靠 job.stage+progress≥51 哨兵,不靠 status)。
    await albumRepo.update(db, albumId, {
      status: 'EDITING',
      stage: 'story',
      draftJson: {
        version: 'v3-story',
        tree: TREE,
        progress: { currentChapterId: 'ch_1', doneChapterIds: [] },
      },
    });
    const job = await agentJobRepo.findByRequestId(requestId);
    assert.ok(job);
    await agentJobRepo.transitionStatus(db, job.id, 'RUNNING', ['QUEUED'], {
      stage: 'layout',
      progress: 51,
      startedAt: new Date(),
    });
    await post({
      requestId,
      jobKind: 'select-layout',
      event: 'progress',
      stage: 'legalize',
      progress: 100,
    });
    await post({
      requestId,
      jobKind: 'select-layout',
      event: 'progress',
      stage: 'wrap',
      progress: 100,
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
    const draftJson = album?.draftJson as { pages?: unknown } & Record<string, unknown>;
    assert.deepEqual({ ...draftJson, pages: stripPagesHtml(draftJson.pages) }, {
      version: 'v3-story',
      tree: TREE,
      pages: PAGES,
      progress: { currentChapterId: 'ch_1', doneChapterIds: [] },
    });
    assert.equal(album?.layoutJson, null);
    assert.equal(album?.stage, 'story');
    // 扣费已在 analyze 完成时结算;此用例直接手 seed 到 progress=51(未过 analyze completed),
    // 故 hold 仍 HOLDING —— 关键是 select-layout completed 本身不再 settle(否则真流程会双扣)。
    const hold = await creditHoldRepo.findById(holdId);
    assert.equal(hold?.status, 'HOLDING');
    const completedJob = await agentJobRepo.findByRequestId(requestId);
    assert.equal(completedJob?.status, 'COMPLETED');
  } finally {
    await cleanupUser(user.id);
  }
});

test('select-layout/completed on a terminal (init) job requestId is ignored — 不给 album 补 pages', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const user = await makeUser('v3route-premature-complete');
  try {
    const { albumId, requestId } = await seed(user.id);
    // 解耦:收集期 album=EDITING/story,init job 已 COMPLETED(排版是另一个独立 layout job)。
    await albumRepo.update(db, albumId, {
      status: 'EDITING',
      stage: 'story',
      draftJson: {
        version: 'v3-story',
        tree: TREE,
        progress: { currentChapterId: 'ch_1', doneChapterIds: [] },
      },
    });
    const job = await agentJobRepo.findByRequestId(requestId);
    assert.ok(job);
    await agentJobRepo.transitionStatus(db, job.id, 'COMPLETED', ['QUEUED', 'RUNNING'], {
      stage: 'wrap',
      progress: 100,
      completedAt: new Date(),
    });

    // 用 init 的 requestId 发来的 select-layout completed 是错乱回调(该 job 已终态),必须被
    // 丢弃,不能给 album 补 pages。
    const res = await post({
      requestId,
      jobKind: 'select-layout',
      event: 'completed',
      pages: PAGES,
      usage: USAGE,
    });
    assert.equal((await res.json()).data.accepted, true);

    const album = await albumRepo.findById(albumId);
    assert.equal(album?.stage, 'story');
    assert.equal((album?.draftJson as { pages?: unknown } | null)?.pages, undefined);
  } finally {
    await cleanupUser(user.id);
  }
});

test('select-layout/completed before analyze tree does not complete job or album', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const user = await makeUser('v3route-layout-before-tree');
  try {
    const { albumId, holdId, requestId } = await seed(user.id);
    await albumRepo.update(db, albumId, {
      status: 'AGENT_RUNNING',
      stage: 'analysing',
      draftJson: null,
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
    assert.equal(album?.status, 'AGENT_RUNNING');
    assert.equal(album?.stage, 'analysing');
    assert.equal(album?.draftJson, null);
    const hold = await creditHoldRepo.findById(holdId);
    assert.equal(hold?.status, 'HOLDING');
    const job = await agentJobRepo.findByRequestId(requestId);
    assert.notEqual(job?.status, 'COMPLETED');
  } finally {
    await cleanupUser(user.id);
  }
});

test('select-layout progress cannot move the reservation marker backwards', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const user = await makeUser('v3route-layout-progress-monotonic');
  try {
    const { requestId } = await seed(user.id);
    const job = await agentJobRepo.findByRequestId(requestId);
    assert.ok(job);
    await agentJobRepo.transitionStatus(db, job.id, 'RUNNING', ['QUEUED'], {
      stage: 'layout',
      progress: 51,
      startedAt: new Date(),
    });

    const res = await post({
      requestId,
      jobKind: 'select-layout',
      event: 'progress',
      stage: 'layout',
      progress: 0,
    });
    assert.equal((await res.json()).data.accepted, true);

    const after = await agentJobRepo.findByRequestId(requestId);
    assert.equal(after?.stage, 'layout');
    assert.equal(after?.progress, 51);
  } finally {
    await cleanupUser(user.id);
  }
});

test('duplicate analyze/completed is idempotent — no-op on the already-completed init job', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const user = await makeUser('v3route-analyze-duplicate-after-reserve');
  try {
    const { albumId, requestId } = await seed(user.id);
    const first = await post({
      requestId,
      jobKind: 'analyze',
      event: 'completed',
      tree: TREE,
      usage: USAGE,
    });
    assert.equal((await first.json()).data.accepted, true);

    // 首次 analyze completed 已把 init job 标 COMPLETED、相册 EDITING/story。重复的 analyze
    // completed 必须幂等 no-op(命中 job 终态守卫),不能把 job/相册退回。
    const duplicate = await post({
      requestId,
      jobKind: 'analyze',
      event: 'completed',
      tree: TREE,
      usage: USAGE,
    });
    assert.equal((await duplicate.json()).data.accepted, true);

    const after = await agentJobRepo.findByRequestId(requestId);
    assert.equal(after?.status, 'COMPLETED');
    assert.equal(after?.stage, 'wrap');
    assert.equal(after?.progress, 100);
    const album = await albumRepo.findById(albumId);
    assert.equal(album?.status, 'EDITING');
    assert.equal(album?.stage, 'story');
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
      stage: 'group',
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
          chapterContext: '',
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
