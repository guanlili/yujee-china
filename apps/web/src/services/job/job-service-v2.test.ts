import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../db/client';
import { agentJobRepo } from '../../db/repos/agent-job-repo';
import { albumRepo } from '../../db/repos/album-repo';
import { albumPageRepo } from '../../db/repos/album-page-repo';
import { creditHoldRepo } from '../../db/repos/credit-hold-repo';
import { creditService } from '../credit/credit-service';
import { cleanupUser, isDbReachable, makeAlbum, makeUser } from '../../db/repos/__test__/setup';
import { jobService } from './job-service';

// Acceptance for W7a (#122): the four v2 callback branches write the DB correctly
// and are idempotent (a callback arriving after a terminal job is dropped).
// rebuild-architecture.md §5 / rebuild-tech-plan.md §1.1/§1.4/§11.

const DRAFT = {
  version: 'v2',
  meta: { style: 'warm-film', language: 'en' },
  photoPool: [],
  basePages: {
    cover: { pageIndex: 0, templateId: 'mag-01', images: {}, texts: {} },
    ending: { pageIndex: 1, templateId: 'mag-17', images: {}, texts: {} },
  },
  chapters: [],
};

const LAYOUT = {
  magazine: { title: 'My Finalized Story', style: 'warm-film', language: 'en' as const },
  photos: [],
  pages: [{ pageIndex: 0, templateId: 'mag-02', images: {}, texts: { headline: 'Hello' } }],
};

const HOLD_AMOUNT = 10;

// Build an album already mid-job: status AGENT_RUNNING + a HOLDING hold linked on
// albums.credit_hold_id + a kind-typed job. Returns ids the assertions need.
async function seedJob(
  userId: string,
  kind: 'init' | 'finalize',
  opts: { draftJson?: unknown } = {},
) {
  const album = await makeAlbum(userId);
  if (opts.draftJson !== undefined) {
    await albumRepo.update(db, album.id, { draftJson: opts.draftJson });
  }
  const hold = await creditHoldRepo.create(db, {
    userId,
    albumId: album.id,
    amount: HOLD_AMOUNT,
    status: 'HOLDING',
  });
  await albumRepo.update(db, album.id, { creditHoldId: hold.id });
  const requestId = `v2-${kind}-${Date.now()}-${Math.round(performance.now())}`;
  const job = await jobService.createV2(db, { userId, albumId: album.id, requestId, kind });
  return { albumId: album.id, holdId: hold.id, requestId, jobId: job.id };
}

test('init/completed → draft_json written, album EDITING, hold stays HOLDING (not settled)', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const user = await makeUser('v2-init-done');
  try {
    const { albumId, holdId, requestId } = await seedJob(user.id, 'init');

    await jobService.handleInitCompleted(requestId, DRAFT, { durationMs: 1, models: {} });

    const album = await albumRepo.findById(albumId);
    assert.equal(album?.status, 'EDITING');
    assert.deepEqual(album?.draftJson, DRAFT);
    assert.equal(album?.layoutJson, null, 'draft-ready: layout_json must stay null');

    const job = await agentJobRepo.findByRequestId(requestId);
    assert.equal(job?.status, 'COMPLETED');
    assert.equal(job?.progress, 100);

    const hold = await creditHoldRepo.findById(holdId);
    assert.equal(hold?.status, 'HOLDING', 'init completion must NOT settle — settle is finalize-only');
  } finally {
    await cleanupUser(user.id);
  }
});

test('finalize/completed → album_pages + layout_json + EDITING + settle (hold SETTLED, balance debited)', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const user = await makeUser('v2-final-done');
  try {
    const { albumId, holdId, requestId } = await seedJob(user.id, 'finalize', { draftJson: DRAFT });
    const balanceBefore = await creditService.getBalance(user.id);

    await jobService.handleFinalizeCompleted(requestId, LAYOUT, { durationMs: 1, models: {} });

    const album = await albumRepo.findById(albumId);
    assert.equal(album?.status, 'EDITING', 'finalized stays EDITING (COMPLETED is for PDF upload)');
    assert.equal(album?.title, LAYOUT.magazine.title);
    assert.equal(album?.pageCount, 1);
    assert.ok(album?.layoutJson, 'layout_json must be written');

    const pages = await albumPageRepo.findByAlbum(albumId);
    assert.equal(pages.length, 1);
    assert.equal(pages[0]?.templateId, 'mag-02');
    assert.deepEqual(pages[0]?.textsJson, { headline: 'Hello' });

    const hold = await creditHoldRepo.findById(holdId);
    assert.equal(hold?.status, 'SETTLED', 'finalize completion settles the single charge');

    const balanceAfter = await creditService.getBalance(user.id);
    assert.equal(balanceAfter, balanceBefore - HOLD_AMOUNT);
  } finally {
    await cleanupUser(user.id);
  }
});

test('init/failed → album FAILED + hold RELEASED', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const user = await makeUser('v2-init-fail');
  try {
    const { albumId, holdId, requestId } = await seedJob(user.id, 'init');

    await jobService.handleV2Failed(requestId, { code: 'AGENT_VISION_FAILED', message: 'boom' });

    const album = await albumRepo.findById(albumId);
    assert.equal(album?.status, 'FAILED');
    assert.equal(album?.errorMessage, 'boom');

    const job = await agentJobRepo.findByRequestId(requestId);
    assert.equal(job?.status, 'FAILED');

    const hold = await creditHoldRepo.findById(holdId);
    assert.equal(hold?.status, 'RELEASED', 'init failure releases the reservation');
  } finally {
    await cleanupUser(user.id);
  }
});

test('finalize/failed → album back to EDITING + hold stays HOLDING (retry-able, opposite of init)', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const user = await makeUser('v2-final-fail');
  try {
    const { albumId, holdId, requestId } = await seedJob(user.id, 'finalize', { draftJson: DRAFT });

    await jobService.handleV2Failed(requestId, { code: 'AGENT_TIMEOUT', message: 'slow' });

    const album = await albumRepo.findById(albumId);
    assert.equal(album?.status, 'EDITING', 'finalize failure returns to EDITING, never FAILED');
    assert.deepEqual(album?.draftJson, DRAFT, 'draft is untouched on finalize failure');
    assert.equal(album?.layoutJson, null);

    const job = await agentJobRepo.findByRequestId(requestId);
    assert.equal(job?.status, 'FAILED');

    const hold = await creditHoldRepo.findById(holdId);
    assert.equal(hold?.status, 'HOLDING', 'finalize failure keeps the hold for retry');
  } finally {
    await cleanupUser(user.id);
  }
});

test('idempotency: a failed callback arriving after init/completed is dropped (terminal wins)', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const user = await makeUser('v2-idem');
  try {
    const { albumId, holdId, requestId } = await seedJob(user.id, 'init');

    await jobService.handleInitCompleted(requestId, DRAFT, { durationMs: 1, models: {} });
    // Late/out-of-order failed — must NOT flip the completed album to FAILED nor
    // release the still-needed hold.
    await jobService.handleV2Failed(requestId, { code: 'AGENT_TIMEOUT', message: 'late' });
    // A duplicate completed must also be a no-op.
    await jobService.handleInitCompleted(requestId, { version: 'v2', tampered: true }, null);

    const album = await albumRepo.findById(albumId);
    assert.equal(album?.status, 'EDITING');
    assert.deepEqual(album?.draftJson, DRAFT, 'draft not overwritten by the duplicate');

    const job = await agentJobRepo.findByRequestId(requestId);
    assert.equal(job?.status, 'COMPLETED');

    const hold = await creditHoldRepo.findById(holdId);
    assert.equal(hold?.status, 'HOLDING');
  } finally {
    await cleanupUser(user.id);
  }
});

test('idempotency: a double-delivered finalize/completed inserts pages once, settles once', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const user = await makeUser('v2-final-dup');
  try {
    const { albumId, holdId, requestId } = await seedJob(user.id, 'finalize', { draftJson: DRAFT });
    const balanceBefore = await creditService.getBalance(user.id);

    await jobService.handleFinalizeCompleted(requestId, LAYOUT, { durationMs: 1, models: {} });
    // Second delivery of the same callback must be a no-op — the win-or-bail job
    // transition keeps it from re-running bulkInsert (uq_album_pages_album_index
    // would otherwise throw) or settling the hold twice.
    await jobService.handleFinalizeCompleted(requestId, LAYOUT, { durationMs: 1, models: {} });

    const pages = await albumPageRepo.findByAlbum(albumId);
    assert.equal(pages.length, 1, 'pages inserted exactly once');

    const hold = await creditHoldRepo.findById(holdId);
    assert.equal(hold?.status, 'SETTLED');
    const balanceAfter = await creditService.getBalance(user.id);
    assert.equal(balanceAfter, balanceBefore - HOLD_AMOUNT, 'charged exactly once');
  } finally {
    await cleanupUser(user.id);
  }
});

test('sweepStaleJob is kind-aware: a finalize zombie → EDITING + hold kept (not FAILED/released)', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const user = await makeUser('v2-final-zombie');
  try {
    const { albumId, holdId, requestId, jobId } = await seedJob(user.id, 'finalize', {
      draftJson: DRAFT,
    });
    // Make it look RUNNING but stale (no heartbeat for an hour).
    await agentJobRepo.update(db, jobId, {
      status: 'RUNNING',
      startedAt: new Date(Date.now() - 60 * 60 * 1000),
    });

    const res = await jobService.sweepStaleJob(jobId, new Date(), 30 * 60 * 1000);
    assert.deepEqual(res, { swept: true, releasedHold: false });

    const album = await albumRepo.findById(albumId);
    assert.equal(album?.status, 'EDITING');

    const job = await agentJobRepo.findByRequestId(requestId);
    assert.equal(job?.status, 'FAILED');
    assert.equal((job?.error as { code?: string })?.code, 'AGENT_TIMEOUT');

    const hold = await creditHoldRepo.findById(holdId);
    assert.equal(hold?.status, 'HOLDING', 'a finalize zombie keeps the hold for retry');
  } finally {
    await cleanupUser(user.id);
  }
});
