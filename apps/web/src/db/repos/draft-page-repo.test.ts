import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Page } from '@yujee/contracts';
import { draftPageRepo } from './draft-page-repo';
import { db } from '../client';
import { cleanupUser, isDbReachable, makeAlbum, makeUser } from './__test__/setup';

const page0: Page = {
  pageIndex: 0,
  templateId: 'tpl-a',
  images: { image: 'photo-1' },
  texts: { title: 'Hello' },
  html: '<div data-template="tpl-a">Hello</div>',
};

// Includes an imagePos entry with `rotate` (#165 rotation field) — the field
// most likely to get silently dropped by a lossy jsonb roundtrip, so its
// presence + exact value is the fidelity assertion's whole point.
const page1: Page = {
  pageIndex: 1,
  templateId: 'tpl-b',
  images: { imageTop: 'photo-2' },
  texts: { caption: 'World' },
  imagePos: { imageTop: { x: 40, y: 60, scale: 1.3, rotate: 90 } },
};

test('draftPageRepo: replaceAll + findByAlbum + countByAlbum + updateOne + idempotent replaceAll + deleteByAlbum', async (t) => {
  if (!(await isDbReachable())) { t.skip('DATABASE_URL is not reachable; skipping'); return; }
  const user = await makeUser('draft-page');
  try {
    const album = await makeAlbum(user.id);

    // --- replaceAll lands rows, read back ascending by pageIndex, jsonb
    // roundtrip is byte-for-byte (including html and imagePos.rotate) ---
    await db.transaction(async (tx) => {
      // Insert out of order to prove findByAlbum sorts, not just echoes insert order.
      await draftPageRepo.replaceAll(tx, album.id, [page1, page0], 1, user.id);
    });

    let rows = await draftPageRepo.findByAlbum(album.id);
    assert.equal(rows.length, 2);
    assert.equal(await draftPageRepo.countByAlbum(album.id), 2);
    assert.deepEqual(
      rows.map((r) => r.pageIndex),
      [0, 1],
    );
    assert.deepEqual(rows[0].page, page0);
    assert.deepEqual(rows[1].page, page1);
    assert.equal(rows[1].page.imagePos?.imageTop?.rotate, 90);
    for (const row of rows) {
      assert.equal(row.version, 1);
      assert.equal(row.updatedBy, user.id);
      assert.equal(row.albumId, album.id);
    }

    // --- updateOne replaces a single row's page/version/updatedBy, leaves
    // the other row untouched ---
    const page0Edited: Page = { ...page0, texts: { title: 'Edited' } };
    await db.transaction(async (tx) => {
      await draftPageRepo.updateOne(tx, album.id, 0, page0Edited, 2, null);
    });

    rows = await draftPageRepo.findByAlbum(album.id);
    assert.equal(rows.length, 2);
    const updated = rows.find((r) => r.pageIndex === 0);
    const untouched = rows.find((r) => r.pageIndex === 1);
    assert.deepEqual(updated?.page, page0Edited);
    assert.equal(updated?.version, 2);
    assert.equal(updated?.updatedBy, null);
    assert.deepEqual(untouched?.page, page1);
    assert.equal(untouched?.version, 1);
    assert.equal(untouched?.updatedBy, user.id);

    // --- updateOne on a pageIndex that doesn't exist rejects loudly and
    // leaves no stray row behind (strict UPDATE, not an upsert) ---
    const countBeforeMiss = await draftPageRepo.countByAlbum(album.id);
    await assert.rejects(
      db.transaction(async (tx) => {
        await draftPageRepo.updateOne(tx, album.id, 99, page0Edited, 4, user.id);
      }),
      /draft_pages\.updateOne: row not found/,
    );
    assert.equal(await draftPageRepo.countByAlbum(album.id), countBeforeMiss);
    assert.equal(
      (await draftPageRepo.findByAlbum(album.id)).find((r) => r.pageIndex === 99),
      undefined,
    );

    // --- replaceAll is idempotent: rerunning with the identical args yields
    // the same two rows, not duplicates ---
    const rerun = [page0Edited, page1];
    for (let i = 0; i < 2; i += 1) {
      await db.transaction(async (tx) => {
        await draftPageRepo.replaceAll(tx, album.id, rerun, 3, user.id);
      });
    }
    rows = await draftPageRepo.findByAlbum(album.id);
    assert.equal(rows.length, 2);
    assert.deepEqual(
      rows.map((r) => r.pageIndex),
      [0, 1],
    );
    for (const row of rows) {
      assert.equal(row.version, 3);
      assert.equal(row.updatedBy, user.id);
    }

    // --- deleteByAlbum clears all rows for the album ---
    await db.transaction(async (tx) => draftPageRepo.deleteByAlbum(tx, album.id));
    assert.equal((await draftPageRepo.findByAlbum(album.id)).length, 0);
    assert.equal(await draftPageRepo.countByAlbum(album.id), 0);
  } finally {
    await cleanupUser(user.id);
  }
});
