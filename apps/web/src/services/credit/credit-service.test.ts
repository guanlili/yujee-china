import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { creditService } from './credit-service';
import { creditLedgerRepo } from '@/db/repos/credit-ledger-repo';
import { creditHoldRepo } from '@/db/repos/credit-hold-repo';
import { users, creditLedger } from '@/db/schema';
import {
  cleanupUser,
  isDbReachable,
  makeAlbum,
  makeUser,
} from '@/db/repos/__test__/setup';
import { CREDIT_COST_PER_ALBUM } from '@/config/pricing';

test('creditService.cost defaults legacy callers to one generation credit', () => {
  assert.equal(creditService.cost(), CREDIT_COST_PER_ALBUM);
  assert.equal(Number.isNaN(creditService.cost()), false);
});

test('creditService: precheck rejects when balance < amount', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL not reachable');
    return;
  }
  const user = await makeUser('precheck-low');
  try {
    await db.update(users).set({ creditBalance: 5 }).where(eq(users.id, user.id));
    await assert.rejects(
      () => creditService.precheck(user.id, 200),
      (err: any) => err.code === 'CREDIT_INSUFFICIENT',
    );
  } finally {
    await cleanupUser(user.id);
  }
});

test('creditService: hold creates hold + 0-delta ledger + links to album', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL not reachable');
    return;
  }
  const user = await makeUser('hold');
  try {
    await db.update(users).set({ creditBalance: 1000 }).where(eq(users.id, user.id));
    const album = await makeAlbum(user.id);
    const holdId = await db.transaction((tx) =>
      creditService.hold(tx, user.id, CREDIT_COST_PER_ALBUM, album.id),
    );

    const hold = await creditHoldRepo.findById(holdId);
    assert.equal(hold?.status, 'HOLDING');
    assert.equal(hold?.amount, CREDIT_COST_PER_ALBUM);

    const ledger = await creditLedgerRepo.findByUser(user.id);
    const holdEntry = ledger.find((l) => l.reason === 'GENERATION_HOLD');
    assert.ok(holdEntry, 'expected GENERATION_HOLD ledger row');
    assert.equal(holdEntry!.delta, 0);
    assert.equal(holdEntry!.relatedHoldId, holdId);

    // balance unchanged at hold time
    const u = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
    assert.equal(u[0]?.creditBalance, 1000);
  } finally {
    await cleanupUser(user.id);
  }
});

test('creditService: settle debits balance + writes negative ledger + flips hold to SETTLED', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL not reachable');
    return;
  }
  const user = await makeUser('settle');
  try {
    await db.update(users).set({ creditBalance: 1000 }).where(eq(users.id, user.id));
    const album = await makeAlbum(user.id);
    const holdId = await db.transaction((tx) =>
      creditService.hold(tx, user.id, 200, album.id),
    );
    await db.transaction((tx) => creditService.settle(tx, user.id, holdId));

    const hold = await creditHoldRepo.findById(holdId);
    assert.equal(hold?.status, 'SETTLED');
    assert.ok(hold?.settledAt);

    const u = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
    assert.equal(u[0]?.creditBalance, 800);

    const ledger = await creditLedgerRepo.findByUser(user.id);
    const settleEntry = ledger.find((l) => l.reason === 'GENERATION_SETTLE');
    assert.ok(settleEntry);
    assert.equal(settleEntry!.delta, -200);
    assert.equal(settleEntry!.balanceAfter, 800);
  } finally {
    await cleanupUser(user.id);
  }
});

test('creditService: settle is idempotent on already-SETTLED hold', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL not reachable');
    return;
  }
  const user = await makeUser('settle-idem');
  try {
    await db.update(users).set({ creditBalance: 1000 }).where(eq(users.id, user.id));
    const album = await makeAlbum(user.id);
    const holdId = await db.transaction((tx) =>
      creditService.hold(tx, user.id, 150, album.id),
    );
    await db.transaction((tx) => creditService.settle(tx, user.id, holdId));
    // Second settle on same hold should be a no-op.
    await db.transaction((tx) => creditService.settle(tx, user.id, holdId));

    const u = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
    assert.equal(u[0]?.creditBalance, 850);

    const ledger = await creditLedgerRepo.findByUser(user.id);
    const settleRows = ledger.filter((l) => l.reason === 'GENERATION_SETTLE');
    assert.equal(settleRows.length, 1, 'only one SETTLE row even after double settle');
  } finally {
    await cleanupUser(user.id);
  }
});

test('creditService: release leaves balance untouched + flips hold to RELEASED', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL not reachable');
    return;
  }
  const user = await makeUser('release');
  try {
    await db.update(users).set({ creditBalance: 1000 }).where(eq(users.id, user.id));
    const album = await makeAlbum(user.id);
    const holdId = await db.transaction((tx) =>
      creditService.hold(tx, user.id, 200, album.id),
    );
    await db.transaction((tx) => creditService.release(tx, holdId));

    const hold = await creditHoldRepo.findById(holdId);
    assert.equal(hold?.status, 'RELEASED');

    const u = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
    assert.equal(u[0]?.creditBalance, 1000);

    const ledger = await creditLedgerRepo.findByUser(user.id);
    const releaseEntry = ledger.find((l) => l.reason === 'GENERATION_RELEASE');
    assert.ok(releaseEntry);
    assert.equal(releaseEntry!.delta, 0);
  } finally {
    await cleanupUser(user.id);
  }
});

test('creditService: applyDelta with externalEventId is idempotent across concurrent inserts', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL not reachable');
    return;
  }
  const user = await makeUser('idem-event');
  try {
    await db.update(users).set({ creditBalance: 100 }).where(eq(users.id, user.id));
    const eventId = `evt_test_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    await db.transaction((tx) =>
      creditService.applyDelta(tx, user.id, 2400, 'PURCHASE', {
        externalEventId: eventId,
        meta: { provider: 'creem' },
      }),
    );

    // Second attempt with the same externalEventId must violate the partial
    // UNIQUE index and fail the whole tx — balance should not double.
    await assert.rejects(() =>
      db.transaction((tx) =>
        creditService.applyDelta(tx, user.id, 2400, 'PURCHASE', {
          externalEventId: eventId,
          meta: { provider: 'creem' },
        }),
      ),
    );

    const u = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
    assert.equal(u[0]?.creditBalance, 2500, 'balance credited exactly once');

    const matching = await db
      .select()
      .from(creditLedger)
      .where(sql`${creditLedger.meta}->>'external_event_id' = ${eventId}`);
    assert.equal(matching.length, 1, 'one ledger row per external event id');
  } finally {
    await cleanupUser(user.id);
  }
});
