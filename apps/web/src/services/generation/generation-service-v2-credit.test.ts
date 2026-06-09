import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '@/db/client';
import { agentJobRepo } from '@/db/repos/agent-job-repo';
import { albumRepo } from '@/db/repos/album-repo';
import { creditHoldRepo } from '@/db/repos/credit-hold-repo';
import { creditService } from '@/services/credit/credit-service';
import { generationService } from '@/services/generation/generation-service';
import { agentClient } from '@/lib/agent/agent-client';
import { jobService } from '@/services/job/job-service';
import { userRepo } from '@/db/repos/user-repo';
import { creditHolds, users } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { cleanupUser, isDbReachable, makeAlbum, makeUser } from '@/db/repos/__test__/setup';
import { ERRORS } from '@/lib/api/error-codes';

// Acceptance for W7b (#123): the two intake transactions own credit.
//  1. submitInitV2 → precheck + hold (HOLDING) committed atomically with album/job.
//  2. submitFinalizeV2 → lock win + 补hold (reuse the HOLDING init hold ≤24h, or
//     re-hold after the 24h sweep released it) committed with the finalize job.
// settle/release/抢锁/idempotency/收尸 are W7a's and are exercised in
// job-service-v2.test.ts — this file only covers the two W7b additions.
// rebuild-tech-plan.md §11 / §12.1, rebuild-architecture.md §5/§6.5.

const COST = creditService.cost();

// One base64 photo — enough to satisfy the init shape; the agent call is mocked.
const INIT_INPUT = {
  requestId: '',
  language: 'en' as const,
  promptHint: 'a road trip',
  photos: [{ photoId: 'p1', base64: 'AAAA', width: 100, height: 100, takenAt: null }],
};

// Mock the async agent submits so dispatch* succeeds (job → RUNNING) without a
// live agent, leaving the intake-tx side effects (hold / 补hold) to assert.
function mockAgent(t: { mock: { method: typeof import('node:test').mock.method } }) {
  t.mock.method(agentClient, 'submitInitV2', async (p: { requestId: string }) => ({
    requestId: p.requestId,
  }));
  t.mock.method(agentClient, 'submitFinalizeV2', async (p: { requestId: string }) => ({
    requestId: p.requestId,
  }));
}

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

test('submitInitV2 → creates a HOLDING hold linked on credit_hold_id, no balance change yet', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  mockAgent(t);
  const user = await makeUser('v2b-init-hold');
  try {
    const balanceBefore = await creditService.getBalance(user.id);
    const requestId = crypto.randomUUID();
    const { albumId } = await generationService.submitInitV2(user.id, { ...INIT_INPUT, requestId });

    const album = await albumRepo.findById(albumId);
    assert.ok(album?.creditHoldId, 'credit_hold_id must be set by init hold');
    const hold = await creditHoldRepo.findById(album!.creditHoldId!);
    assert.equal(hold?.status, 'HOLDING');
    assert.equal(hold?.amount, COST);

    // hold reserves but does NOT debit — settle (at finalize) is where the charge lands.
    const balanceAfter = await creditService.getBalance(user.id);
    assert.equal(balanceAfter, balanceBefore, 'hold must not debit the balance');
  } finally {
    await cleanupUser(user.id);
  }
});

test('submitInitV2 → insufficient balance throws CREDIT_INSUFFICIENT and rolls back (no album/job/hold)', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  mockAgent(t);
  const user = await makeUser('v2b-init-broke');
  try {
    await db.update(users).set({ creditBalance: 0 }).where(eq(users.id, user.id));

    const requestId = crypto.randomUUID();
    await assert.rejects(
      () => generationService.submitInitV2(user.id, { ...INIT_INPUT, requestId }),
      (e: unknown) => (e as { code?: string })?.code === ERRORS.CREDIT_INSUFFICIENT().code,
    );

    // precheck runs before the tx — nothing should have been written.
    const job = await agentJobRepo.findByRequestId(requestId);
    assert.equal(job, undefined, 'no job created when precheck fails');
    const reloaded = await userRepo.findById(user.id);
    assert.equal(reloaded?.creditBalance, 0);
  } finally {
    await cleanupUser(user.id);
  }
});

test('finalize 补hold: re-entry ≤24h reuses the still-HOLDING init hold (no second charge)', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  mockAgent(t);
  const user = await makeUser('v2b-final-reuse');
  try {
    // Album already in EDITING with a draft + a HOLDING hold (the init hold).
    const album = await makeAlbum(user.id);
    await albumRepo.update(db, album.id, { status: 'EDITING', draftJson: DRAFT });
    const initHoldId = await creditService.hold(db, user.id, COST, album.id);

    await generationService.submitFinalizeV2(user.id, album.id);

    const reloaded = await albumRepo.findById(album.id);
    assert.equal(reloaded?.creditHoldId, initHoldId, 'must reuse the original hold pointer');
    const hold = await creditHoldRepo.findById(initHoldId);
    assert.equal(hold?.status, 'HOLDING', 'reused hold stays HOLDING until settle');

    // Exactly one HOLDING hold for the album — no 补hold double-create.
    const holding = await db
      .select()
      .from(creditHolds)
      .where(and(eq(creditHolds.albumId, album.id), eq(creditHolds.status, 'HOLDING')));
    assert.equal(holding.length, 1);
  } finally {
    await cleanupUser(user.id);
  }
});

test('finalize 补hold: after the init hold was released, a fresh HOLDING hold is created + re-pointed; settle then debits', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  mockAgent(t);
  const user = await makeUser('v2b-final-rehold');
  try {
    const album = await makeAlbum(user.id);
    await albumRepo.update(db, album.id, { status: 'EDITING', draftJson: DRAFT });
    // Init hold then released (simulating the 24h draft-expiry sweep, W7c).
    const initHoldId = await creditService.hold(db, user.id, COST, album.id);
    await db.transaction((tx) => creditService.release(tx, initHoldId));
    assert.equal((await creditHoldRepo.findById(initHoldId))?.status, 'RELEASED');

    const balanceBefore = await creditService.getBalance(user.id);
    const { requestId } = await generationService.submitFinalizeV2(user.id, album.id);

    const reloaded = await albumRepo.findById(album.id);
    assert.notEqual(reloaded?.creditHoldId, initHoldId, 'credit_hold_id must re-point to a NEW hold');
    const newHold = await creditHoldRepo.findById(reloaded!.creditHoldId!);
    assert.equal(newHold?.status, 'HOLDING');

    // settle on the re-pointed hold debits exactly the cost once (real charge).
    await jobService.handleFinalizeCompleted(
      requestId,
      {
        magazine: { title: 'Done', style: 'warm-film', language: 'en' as const },
        photos: [],
        pages: [{ pageIndex: 0, templateId: 'mag-02', images: {}, texts: {} }],
      },
      { durationMs: 1, models: {} },
    );

    const settled = await creditHoldRepo.findById(reloaded!.creditHoldId!);
    assert.equal(settled?.status, 'SETTLED');
    const balanceAfter = await creditService.getBalance(user.id);
    assert.equal(balanceAfter, balanceBefore - COST, 'finalize settle charges exactly once');
  } finally {
    await cleanupUser(user.id);
  }
});

test('finalize 补hold: insufficient balance after expiry throws CREDIT_INSUFFICIENT and rolls the lock back to EDITING', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  mockAgent(t);
  const user = await makeUser('v2b-final-broke');
  try {
    const album = await makeAlbum(user.id);
    await albumRepo.update(db, album.id, { status: 'EDITING', draftJson: DRAFT });
    const initHoldId = await creditService.hold(db, user.id, COST, album.id);
    await db.transaction((tx) => creditService.release(tx, initHoldId));
    await db.update(users).set({ creditBalance: 0 }).where(eq(users.id, user.id));

    await assert.rejects(
      () => generationService.submitFinalizeV2(user.id, album.id),
      (e: unknown) => (e as { code?: string })?.code === ERRORS.CREDIT_INSUFFICIENT().code,
    );

    // The lock-win UPDATE rolled back with the failed precheck — album stays EDITING.
    const reloaded = await albumRepo.findById(album.id);
    assert.equal(reloaded?.status, 'EDITING', 'failed 补hold must roll the AGENT_RUNNING lock back');
  } finally {
    await cleanupUser(user.id);
  }
});
