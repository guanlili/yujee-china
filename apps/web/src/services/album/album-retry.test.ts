import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { albumService } from './album-service';
import { albumRepo } from '@/db/repos/album-repo';
import { albums } from '@/db/schema';
import { cleanupUser, isDbReachable, makeAlbum, makeUser } from '@/db/repos/__test__/setup';

// §6.5.3: retry reuses the SAME album, claiming FAILED → AGENT_RUNNING exactly
// once. These cover the transition guard that keeps a double-retry from starting
// two generations / double-holding credit.

test('albumService.setRetrying: FAILED → AGENT_RUNNING and clears errorMessage', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL not reachable');
    return;
  }
  const user = await makeUser('retry-ok');
  try {
    const album = await makeAlbum(user.id);
    await db
      .update(albums)
      .set({ status: 'FAILED', errorMessage: 'Generation timed out.' })
      .where(eq(albums.id, album.id));

    await db.transaction((tx) => albumService.setRetrying(tx, album.id));

    const after = await albumRepo.findById(album.id);
    assert.equal(after?.status, 'AGENT_RUNNING');
    assert.equal(after?.errorMessage, null);
  } finally {
    await cleanupUser(user.id);
  }
});

test('albumService.setRetrying: rejects a non-FAILED album with ALBUM_NOT_RETRIABLE', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL not reachable');
    return;
  }
  const user = await makeUser('retry-guard');
  try {
    // makeAlbum starts AGENT_RUNNING — not retriable.
    const album = await makeAlbum(user.id);
    await assert.rejects(
      () => db.transaction((tx) => albumService.setRetrying(tx, album.id)),
      (err: { code?: string }) => err.code === 'ALBUM_NOT_RETRIABLE',
    );
    const after = await albumRepo.findById(album.id);
    assert.equal(after?.status, 'AGENT_RUNNING'); // untouched
  } finally {
    await cleanupUser(user.id);
  }
});

test('albumService.setRetrying: only the first of two concurrent claims wins', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL not reachable');
    return;
  }
  const user = await makeUser('retry-race');
  try {
    const album = await makeAlbum(user.id);
    await db.update(albums).set({ status: 'FAILED' }).where(eq(albums.id, album.id));

    // Run both transitions; exactly one should win, the other ALBUM_NOT_RETRIABLE.
    const results = await Promise.allSettled([
      db.transaction((tx) => albumService.setRetrying(tx, album.id)),
      db.transaction((tx) => albumService.setRetrying(tx, album.id)),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
    const rejected = results.filter(
      (r) => r.status === 'rejected' && r.reason?.code === 'ALBUM_NOT_RETRIABLE',
    ).length;
    assert.equal(fulfilled, 1, 'exactly one retry claim wins');
    assert.equal(rejected, 1, 'the loser gets ALBUM_NOT_RETRIABLE');
  } finally {
    await cleanupUser(user.id);
  }
});
