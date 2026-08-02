import { test } from 'node:test';
import assert from 'node:assert/strict';
import { albumPhotoRepo } from './album-photo-repo';
import { db } from '../client';
import { cleanupUser, isDbReachable, makeAlbum, makeUser } from './__test__/setup';

test('albumPhotoRepo: upsertMany + findByAlbum + missing 不覆盖 uploaded', async (t) => {
  if (!(await isDbReachable())) { t.skip('DATABASE_URL is not reachable; skipping'); return; }
  const user = await makeUser('album-photo');
  try {
    const album = await makeAlbum(user.id);
    await db.transaction(async (tx) => {
      await albumPhotoRepo.upsertMany(tx, album.id, [
        { photoId: 'p1', status: 'uploaded', width: 100, height: 80, bytes: 1234 },
        { photoId: 'p2', status: 'missing' },
      ]);
    });
    let rows = await albumPhotoRepo.findByAlbum(album.id);
    assert.equal(rows.length, 2);
    // 重复 upsert 幂等,且 uploaded 覆盖 missing
    await db.transaction(async (tx) => {
      await albumPhotoRepo.upsertMany(tx, album.id, [{ photoId: 'p2', status: 'uploaded', width: 5, height: 5, bytes: 9 }]);
    });
    rows = await albumPhotoRepo.findByAlbum(album.id);
    assert.equal(rows.find((r) => r.photoId === 'p2')?.status, 'uploaded');
    await db.transaction(async (tx) => albumPhotoRepo.deleteByAlbum(tx, album.id));
    assert.equal((await albumPhotoRepo.findByAlbum(album.id)).length, 0);
  } finally {
    await cleanupUser(user.id);
  }
});
