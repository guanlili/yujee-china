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

// Acceptance for CHARGE-AT-INIT (§6.7): the single credit charge moves from finalize
// to init-success. The two intake transactions and the init callback own credit:
//  1. submitInitV2 → precheck + hold (HOLDING) committed atomically with album/job;
//     hold reserves but does NOT debit yet.
//  2. handleInitCompleted (init success) → settle the hold → the single debit lands.
//     handleV2Failed/sweep on a failed init → release, never charged.
//  3. submitFinalizeV2 → re-render only, NO credit work (the charge already settled).
// settle/release idempotency under callback races is exercised in job-service-v2.test.ts.

// One base64 photo → COST = creditsForPhotos(1) = 1.
const COST = creditService.cost(1);

const INIT_INPUT = {
  requestId: '',
  language: 'en' as const,
  promptHint: 'a road trip',
  photos: [{ photoId: 'p1', base64: 'AAAA', width: 100, height: 100, takenAt: null }],
};

// Mock the async agent submits so dispatch* succeeds (job → RUNNING) without a
// live agent, leaving the intake-tx side effects (hold / settle) to assert.
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
  const user = await makeUser('v2c-init-hold');
  try {
    const balanceBefore = await creditService.getBalance(user.id);
    const requestId = crypto.randomUUID();
    const { albumId } = await generationService.submitInitV2(user.id, { ...INIT_INPUT, requestId });

    const album = await albumRepo.findById(albumId);
    assert.ok(album?.creditHoldId, 'credit_hold_id must be set by init hold');
    const hold = await creditHoldRepo.findById(album!.creditHoldId!);
    assert.equal(hold?.status, 'HOLDING');
    assert.equal(hold?.amount, COST);

    // hold reserves but does NOT debit — settle (at init success) is the charge.
    const balanceAfter = await creditService.getBalance(user.id);
    assert.equal(balanceAfter, balanceBefore, 'hold must not debit the balance');
  } finally {
    await cleanupUser(user.id);
  }
});

test('submitInitV2 → insufficient balance throws CREDIT_INSUFFICIENT and rolls back (no album/job/hold)', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  mockAgent(t);
  const user = await makeUser('v2c-init-broke');
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

test('init success → handleInitCompleted settles the hold and debits exactly COST once', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  mockAgent(t);
  const user = await makeUser('v2c-init-settle');
  try {
    const balanceBefore = await creditService.getBalance(user.id);
    const requestId = crypto.randomUUID();
    const { albumId } = await generationService.submitInitV2(user.id, { ...INIT_INPUT, requestId });
    const holdId = (await albumRepo.findById(albumId))!.creditHoldId!;

    await jobService.handleInitCompleted(requestId, DRAFT, { durationMs: 1, models: {} });

    const hold = await creditHoldRepo.findById(holdId);
    assert.equal(hold?.status, 'SETTLED', 'init success must settle the hold');
    const balanceAfter = await creditService.getBalance(user.id);
    assert.equal(balanceAfter, balanceBefore - COST, 'init success charges exactly once');

    // Draft is written; album sits in EDITING, layout still null (not finalized yet).
    const album = await albumRepo.findById(albumId);
    assert.equal(album?.status, 'EDITING');
    assert.equal(album?.layoutJson, null);
  } finally {
    await cleanupUser(user.id);
  }
});

test('init failure → handleV2Failed releases the hold, no charge', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  mockAgent(t);
  const user = await makeUser('v2c-init-fail');
  try {
    const balanceBefore = await creditService.getBalance(user.id);
    const requestId = crypto.randomUUID();
    const { albumId } = await generationService.submitInitV2(user.id, { ...INIT_INPUT, requestId });
    const holdId = (await albumRepo.findById(albumId))!.creditHoldId!;

    await jobService.handleV2Failed(requestId, { code: 'AGENT_INTERNAL_ERROR', message: 'boom' });

    const hold = await creditHoldRepo.findById(holdId);
    assert.equal(hold?.status, 'RELEASED', 'failed init must release the hold');
    const balanceAfter = await creditService.getBalance(user.id);
    assert.equal(balanceAfter, balanceBefore, 'failed init must not debit the balance');
    const album = await albumRepo.findById(albumId);
    assert.equal(album?.status, 'FAILED');
  } finally {
    await cleanupUser(user.id);
  }
});

test('submitFinalizeV2 → re-render only: no new hold, no debit (already charged at init)', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  mockAgent(t);
  const user = await makeUser('v2c-final-free');
  try {
    // An album already finalized-eligible: EDITING + draft, with the init hold SETTLED
    // (the charge already landed at init success).
    const album = await makeAlbum(user.id);
    await albumRepo.update(db, album.id, { status: 'EDITING', draftJson: DRAFT });
    const holdId = await creditService.hold(db, user.id, COST, album.id);
    await db.transaction((tx) => creditService.settle(tx, user.id, holdId));

    const balanceBefore = await creditService.getBalance(user.id);
    await generationService.submitFinalizeV2(user.id, album.id);

    // Finalize must not touch credit: no NEW holding hold, balance unchanged.
    const holding = await db
      .select()
      .from(creditHolds)
      .where(and(eq(creditHolds.albumId, album.id), eq(creditHolds.status, 'HOLDING')));
    assert.equal(holding.length, 0, 'finalize must not create a new HOLDING hold');
    const balanceAfter = await creditService.getBalance(user.id);
    assert.equal(balanceAfter, balanceBefore, 'finalize must not debit the balance');
  } finally {
    await cleanupUser(user.id);
  }
});
