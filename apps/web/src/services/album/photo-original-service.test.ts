import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { albumPhotoRepo } from '../../db/repos/album-photo-repo';
import { cleanupUser, isDbReachable, makeAlbum, makeUser } from '../../db/repos/__test__/setup';
import { r2 } from '../../lib/r2/r2-client';
import { photoOriginalService } from './photo-original-service';
import { photoOriginalKey, PHOTO_ORIGINAL_CONTENT_TYPE } from './photo-original-util';

/* 照片真相(album_photos)的三条守则:
   1. 防覆盖闸:已 uploaded 的 photoId 不再签发 PUT —— 签名 PUT 恒覆盖写,
      重签 = 静默覆盖别人上传的原始字节。
   2. confirm 只升不降:已 uploaded 的 id 出现在 missing(旧客户端/重复上报)
      必须被过滤;missing→uploaded 是允许的唯一方向,并落最后上传者署名。
   3. getUrls 只签 uploaded 且在请求范围内的 id;missing 一律当作「没有原图」。 */

function stubR2(t: { mock: { method: typeof import('node:test').mock.method } }) {
  t.mock.method(r2, 'signPutUrl', async () => 'https://put.example/signed');
  t.mock.method(r2, 'signGetUrl', async () => 'https://get.example/signed');
}

function entry(photoId: string) {
  return { photoId, width: 800, height: 600, bytes: 12345 };
}

test('signUpload: 只签新 photoId,已 uploaded 的不再签发(防覆盖闸)', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping integration test');
    return;
  }
  stubR2(t);
  const user = await makeUser('photo-sign');
  try {
    const album = await makeAlbum(user.id);
    const p1 = randomUUID();
    const p2 = randomUUID();

    const first = await photoOriginalService.signUpload(user.id, album.id, [entry(p1), entry(p2)]);
    assert.equal(first.length, 2);
    assert.equal(first[0]!.r2Key, photoOriginalKey(album.id, p1), 'key 按 album 命名空间');
    assert.ok(first[0]!.putUrl.startsWith('https://put.example/'));

    // p1 confirm 成 uploaded 后,再签会被过滤;新 id p2 仍签。
    await photoOriginalService.confirm(user.id, album.id, { entries: [entry(p1)] });
    const second = await photoOriginalService.signUpload(user.id, album.id, [entry(p1), entry(p2)]);
    assert.equal(second.length, 1, '已 uploaded 的 p1 不许重签');
    assert.equal(second[0]!.photoId, p2);
  } finally {
    await cleanupUser(user.id);
  }
});

test('confirm: 计数口径、只升不降、missing→uploaded 流转与署名', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping integration test');
    return;
  }
  const user = await makeUser('photo-confirm');
  try {
    const album = await makeAlbum(user.id);
    const up1 = randomUUID();
    const up2 = randomUUID();
    const miss = randomUUID();

    const r1 = await photoOriginalService.confirm(user.id, album.id, {
      entries: [entry(up1), entry(up2)],
      missing: [miss],
    });
    assert.deepEqual(r1, { uploaded: 2, missing: 1 }, '返回全表口径');

    let rows = await albumPhotoRepo.findByAlbum(album.id);
    const row1 = rows.find((r) => r.photoId === up1)!;
    assert.equal(row1.status, 'uploaded');
    assert.equal(row1.uploadedBy, user.id, '署名 = 本次 confirm 执行者');
    assert.equal(row1.width, 800, '元数据必须随行带上,不许 null 掉');
    assert.equal(rows.find((r) => r.photoId === miss)?.status, 'missing');

    // 已 uploaded 的 id 出现在 missing(重复上报):过滤,不降级。
    const r2r = await photoOriginalService.confirm(user.id, album.id, { missing: [up1] });
    assert.deepEqual(r2r, { uploaded: 2, missing: 1 }, 'stale missing 不改变口径');
    rows = await albumPhotoRepo.findByAlbum(album.id);
    assert.equal(rows.find((r) => r.photoId === up1)?.status, 'uploaded', 'uploaded 不许被降级');

    // missing → uploaded 是允许的方向。
    const r3 = await photoOriginalService.confirm(user.id, album.id, { entries: [entry(miss)] });
    assert.deepEqual(r3, { uploaded: 3, missing: 0 });
  } finally {
    await cleanupUser(user.id);
  }
});

test('getUrls: 只签 uploaded 且在请求范围内的 id', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping integration test');
    return;
  }
  stubR2(t);
  const user = await makeUser('photo-urls');
  try {
    const album = await makeAlbum(user.id);
    const up = randomUUID();
    const miss = randomUUID();
    const notRequested = randomUUID();

    await photoOriginalService.confirm(user.id, album.id, {
      entries: [entry(up), entry(notRequested)],
      missing: [miss],
    });

    const urls = await photoOriginalService.getUrls(user.id, album.id, [up, miss]);
    assert.deepEqual(Object.keys(urls), [up], '只签 uploaded,missing 当作没有原图');
    assert.ok(urls[up]!.startsWith('https://get.example/'));

    const empty = await photoOriginalService.getUrls(user.id, album.id, [miss]);
    assert.deepEqual(empty, {}, '全部缺原图时返回空对象,不报错');
  } finally {
    await cleanupUser(user.id);
  }
});

test('路人不许签/确认别人的相册(ALBUM_ACCESS_DENIED)', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping integration test');
    return;
  }
  stubR2(t);
  const owner = await makeUser('photo-owner');
  const stranger = await makeUser('photo-stranger');
  try {
    const album = await makeAlbum(owner.id);
    const p = randomUUID();
    await assert.rejects(
      photoOriginalService.signUpload(stranger.id, album.id, [entry(p)]),
      (e: unknown) => (e as { code?: string }).code === 'ALBUM_ACCESS_DENIED',
    );
    await assert.rejects(
      photoOriginalService.confirm(stranger.id, album.id, { entries: [entry(p)] }),
      (e: unknown) => (e as { code?: string }).code === 'ALBUM_ACCESS_DENIED',
    );
    await assert.rejects(
      photoOriginalService.getUrls(stranger.id, album.id, [p]),
      (e: unknown) => (e as { code?: string }).code === 'ALBUM_ACCESS_DENIED',
    );
  } finally {
    await cleanupUser(owner.id);
    await cleanupUser(stranger.id);
  }
});
