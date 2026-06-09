import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../db/client';
import { albumRepo } from '../../db/repos/album-repo';
import { creditHoldRepo } from '../../db/repos/credit-hold-repo';
import { creditLedgerRepo } from '../../db/repos/credit-ledger-repo';
import {
  cleanupUser,
  isDbReachable,
  makeAlbum,
  makeUser,
} from '../../db/repos/__test__/setup';
import { draftExpirySweeper } from './draft-expiry-sweeper';

const HOUR = 60 * 60 * 1000;
const EXPIRY_MS = 24 * HOUR;

// Helper: an EDITING idle draft (init succeeded, never finalized) with a HOLDING
// hold, last touched `ageMs` ago.
async function makeIdleDraft(userId: string, ageMs: number) {
  const album = await makeAlbum(userId);
  const hold = await creditHoldRepo.create(db, {
    userId,
    albumId: album.id,
    amount: 10,
    status: 'HOLDING',
  });
  // EDITING + draft_json set + layout_json null = idle draft. update() touches
  // updated_at, then we backdate it to simulate idleness.
  await albumRepo.update(db, album.id, {
    status: 'EDITING',
    draftJson: { magazine: { title: 'draft' }, chapters: [] },
    creditHoldId: hold.id,
  });
  await db.execute(
    // backdate updated_at past/within the cutoff
    (await import('drizzle-orm')).sql`update albums set updated_at = ${new Date(
      Date.now() - ageMs,
    ).toISOString()} where id = ${album.id}`,
  );
  return { album, hold };
}

test('draftExpirySweeper: idle draft past 24h → hold RELEASED, album stays EDITING with draft', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping draft-expiry integration test');
    return;
  }
  const user = await makeUser('draft-expiry');
  try {
    const { album, hold } = await makeIdleDraft(user.id, 25 * HOUR);

    const result = await draftExpirySweeper.sweep('system');
    assert.ok(result.scanned >= 1);
    assert.ok(result.releasedHolds >= 1);

    const holdAfter = await creditHoldRepo.findById(hold.id);
    assert.equal(holdAfter?.status, 'RELEASED');

    // album untouched: still EDITING, draft kept (user can return)
    const albumAfter = await albumRepo.findById(album.id);
    assert.equal(albumAfter?.status, 'EDITING');
    assert.notEqual(albumAfter?.draftJson, null);

    // a GENERATION_RELEASE crumb was written, no debit (delta 0)
    const ledger = await creditLedgerRepo.findByUser(user.id, 50);
    const release = ledger.find((l) => l.reason === 'GENERATION_RELEASE');
    assert.ok(release, 'expected a GENERATION_RELEASE ledger row');
    assert.equal(release?.delta, 0);
  } finally {
    await cleanupUser(user.id);
  }
});

test('draftExpirySweeper: draft within 24h is NOT released', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping draft-expiry integration test');
    return;
  }
  const user = await makeUser('draft-fresh');
  try {
    const { hold } = await makeIdleDraft(user.id, 1 * HOUR); // touched 1h ago

    await draftExpirySweeper.sweep('system');

    const holdAfter = await creditHoldRepo.findById(hold.id);
    assert.equal(holdAfter?.status, 'HOLDING'); // untouched
  } finally {
    await cleanupUser(user.id);
  }
});

test('draftExpirySweeper: a finalized album (layout_json set) is never swept as a draft', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping draft-expiry integration test');
    return;
  }
  const user = await makeUser('draft-finalized');
  try {
    const album = await makeAlbum(user.id);
    const hold = await creditHoldRepo.create(db, {
      userId: user.id,
      albumId: album.id,
      amount: 10,
      status: 'HOLDING',
    });
    // EDITING but layout_json set → finalized, not an idle draft.
    await albumRepo.update(db, album.id, {
      status: 'EDITING',
      draftJson: { magazine: { title: 'draft' }, chapters: [] },
      layoutJson: { magazine: {}, pages: [] },
      creditHoldId: hold.id,
    });
    await db.execute(
      (await import('drizzle-orm')).sql`update albums set updated_at = ${new Date(
        Date.now() - 30 * HOUR,
      ).toISOString()} where id = ${album.id}`,
    );

    await draftExpirySweeper.sweep('system');

    const holdAfter = await creditHoldRepo.findById(hold.id);
    assert.equal(holdAfter?.status, 'HOLDING'); // layout_json guard kept it
  } finally {
    await cleanupUser(user.id);
  }
});

test('draftExpirySweeper: read-time sweepAlbumOnRead releases an expired draft on the spot', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping draft-expiry integration test');
    return;
  }
  const user = await makeUser('draft-readtime');
  try {
    const { album, hold } = await makeIdleDraft(user.id, 25 * HOUR);

    const released = await draftExpirySweeper.sweepAlbumOnRead(album.id);
    assert.equal(released, true);

    const holdAfter = await creditHoldRepo.findById(hold.id);
    assert.equal(holdAfter?.status, 'RELEASED');
  } finally {
    await cleanupUser(user.id);
  }
});

test('draftExpirySweeper: read-time sweep no-ops on a fresh draft', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping draft-expiry integration test');
    return;
  }
  const user = await makeUser('draft-readtime-fresh');
  try {
    const { album, hold } = await makeIdleDraft(user.id, 1 * HOUR);

    const released = await draftExpirySweeper.sweepAlbumOnRead(album.id);
    assert.equal(released, false);

    const holdAfter = await creditHoldRepo.findById(hold.id);
    assert.equal(holdAfter?.status, 'HOLDING');
  } finally {
    await cleanupUser(user.id);
  }
});

test('draftExpirySweeper: re-running is idempotent (already RELEASED hold no-ops)', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping draft-expiry integration test');
    return;
  }
  const user = await makeUser('draft-idempotent');
  try {
    const { hold } = await makeIdleDraft(user.id, 25 * HOUR);

    await draftExpirySweeper.sweep('system');
    const second = await draftExpirySweeper.sweep('system');
    // second pass finds nothing for this user's hold (already RELEASED → not HOLDING)
    const holdAfter = await creditHoldRepo.findById(hold.id);
    assert.equal(holdAfter?.status, 'RELEASED');

    // exactly one GENERATION_RELEASE crumb for this hold
    const ledger = await creditLedgerRepo.findByUser(user.id, 50);
    const releases = ledger.filter(
      (l) => l.reason === 'GENERATION_RELEASE' && l.relatedAlbumId,
    );
    assert.equal(releases.length, 1);
    assert.ok(second.scanned >= 0);
  } finally {
    await cleanupUser(user.id);
  }
});

test('draftExpirySweeper: touching updated_at keeps the draft alive past the original cutoff', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping draft-expiry integration test');
    return;
  }
  const user = await makeUser('draft-touch');
  try {
    const { album, hold } = await makeIdleDraft(user.id, 25 * HOUR); // would be expired

    // a chapter-chat/theme round re-writes the draft → albumRepo.update touches
    // updated_at to "now", resetting the 24h idle clock.
    await albumRepo.update(db, album.id, {
      draftJson: { magazine: { title: 'edited' }, chapters: [] },
    });

    await draftExpirySweeper.sweep('system');

    const holdAfter = await creditHoldRepo.findById(hold.id);
    assert.equal(holdAfter?.status, 'HOLDING'); // refreshed → not expired
  } finally {
    await cleanupUser(user.id);
  }
});
