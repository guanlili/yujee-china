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

    // (a) 已 uploaded 的行再收到一条 'missing' upsert:status 不降级,
    // width/height/bytes 也保持原值不被清空。
    await db.transaction(async (tx) => {
      await albumPhotoRepo.upsertMany(tx, album.id, [{ photoId: 'p1', status: 'missing' }]);
    });
    rows = await albumPhotoRepo.findByAlbum(album.id);
    const p1AfterMissing = rows.find((r) => r.photoId === 'p1');
    assert.equal(p1AfterMissing?.status, 'uploaded');
    assert.equal(p1AfterMissing?.width, 100);
    assert.equal(p1AfterMissing?.height, 80);
    assert.equal(p1AfterMissing?.bytes, 1234);

    // (b) 已 uploaded 的行再收到一条新的 'uploaded' upsert(合法重新上传,
    // R2 对象已被覆盖):metadata 必须跟着更新到新值,不能停留在旧值。
    await db.transaction(async (tx) => {
      await albumPhotoRepo.upsertMany(tx, album.id, [
        { photoId: 'p1', status: 'uploaded', width: 200, height: 160, bytes: 5678 },
      ]);
    });
    rows = await albumPhotoRepo.findByAlbum(album.id);
    const p1AfterReupload = rows.find((r) => r.photoId === 'p1');
    assert.equal(p1AfterReupload?.status, 'uploaded');
    assert.equal(p1AfterReupload?.width, 200);
    assert.equal(p1AfterReupload?.height, 160);
    assert.equal(p1AfterReupload?.bytes, 5678);

    // (c) 重复 upsert 幂等,且 missing → uploaded 翻转生效,metadata 一并写入。
    await db.transaction(async (tx) => {
      await albumPhotoRepo.upsertMany(tx, album.id, [{ photoId: 'p2', status: 'uploaded', width: 5, height: 5, bytes: 9 }]);
    });
    rows = await albumPhotoRepo.findByAlbum(album.id);
    const p2AfterFlip = rows.find((r) => r.photoId === 'p2');
    assert.equal(p2AfterFlip?.status, 'uploaded');
    assert.equal(p2AfterFlip?.width, 5);
    assert.equal(p2AfterFlip?.height, 5);
    assert.equal(p2AfterFlip?.bytes, 9);

    await db.transaction(async (tx) => albumPhotoRepo.deleteByAlbum(tx, album.id));
    assert.equal((await albumPhotoRepo.findByAlbum(album.id)).length, 0);
  } finally {
    await cleanupUser(user.id);
  }
});
