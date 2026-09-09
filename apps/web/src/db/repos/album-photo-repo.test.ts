import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PhotoProfileSchema } from '@yujee/contracts';
import { sql } from 'drizzle-orm';
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

test('albumPhotoRepo: countByStatus aggregates uploaded/missing without a full-row fetch', async (t) => {
  if (!(await isDbReachable())) { t.skip('DATABASE_URL is not reachable; skipping'); return; }
  const user = await makeUser('album-photo-count');
  try {
    const album = await makeAlbum(user.id);

    // No rows yet — both statuses default to 0, not undefined.
    assert.deepEqual(await albumPhotoRepo.countByStatus(album.id), { uploaded: 0, missing: 0 });

    await db.transaction(async (tx) => {
      await albumPhotoRepo.upsertMany(tx, album.id, [
        { photoId: 'p1', status: 'uploaded', width: 100, height: 80, bytes: 1234 },
        { photoId: 'p2', status: 'uploaded', width: 200, height: 160, bytes: 5678 },
        { photoId: 'p3', status: 'missing' },
      ]);
    });
    assert.deepEqual(await albumPhotoRepo.countByStatus(album.id), { uploaded: 2, missing: 1 });
  } finally {
    await cleanupUser(user.id);
  }
});

// ── 照片视觉档案(profile 列)──────────────────────────────────────────────
// 契约:packages/contracts/src/photo-profile.ts。写只 UPDATE 不 INSERT(照片行的
// 真相源是上传流程);读遇到形状不合法的行跳过并 warn —— 一张照片的坏档案不该
// 让整本书打不开。

const sampleProfile = {
  v: 1 as const,
  subjectBox: { x: 10, y: 20, w: 50, h: 60 },
  faceBoxes: [],
  maskKey: null,
  colorTemp: 'warm' as const,
  brightness: 'mid' as const,
  saturation: 'normal' as const,
  dominantColors: ['#C8A05A'],
  composition: 'focal' as const,
  scene: 'outdoor' as const,
  peopleCount: '1' as const,
  mood: 'warm' as const,
  description: '海边',
};

test('albumPhotoRepo: setProfiles 写入后能读回,且过得了契约', async (t) => {
  if (!(await isDbReachable())) { t.skip('DATABASE_URL is not reachable; skipping'); return; }
  const user = await makeUser('album-photo-profile');
  try {
    const album = await makeAlbum(user.id);
    await db.transaction(async (tx) => {
      await albumPhotoRepo.upsertMany(tx, album.id, [
        { photoId: 'p1', status: 'uploaded' },
        { photoId: 'p_never_profiled', status: 'uploaded' },
      ]);
    });

    await albumPhotoRepo.setProfiles(album.id, { p1: sampleProfile });
    const back = await albumPhotoRepo.findProfilesByAlbum(album.id);
    assert.deepEqual(PhotoProfileSchema.parse(back.p1), sampleProfile);

    // 没有档案的行不出现在结果里(不是返回 null,是压根不出现)。
    assert.equal(back.p_never_profiled, undefined);
  } finally {
    await cleanupUser(user.id);
  }
});

test('albumPhotoRepo: setProfiles 不会凭空造行', async (t) => {
  if (!(await isDbReachable())) { t.skip('DATABASE_URL is not reachable; skipping'); return; }
  const user = await makeUser('album-photo-profile-ghost');
  try {
    const album = await makeAlbum(user.id);
    // 照片行的真相源是上传流程,档案只是给已有行贴附加信息。凭空 INSERT 会让
    // countByStatus 之类的统计错乱。
    await albumPhotoRepo.setProfiles(album.id, { ghost: sampleProfile });
    const back = await albumPhotoRepo.findProfilesByAlbum(album.id);
    assert.equal(back.ghost, undefined);
    assert.equal((await albumPhotoRepo.findByAlbum(album.id)).length, 0);
  } finally {
    await cleanupUser(user.id);
  }
});

test('albumPhotoRepo: 库里存了坏档案时跳过该行,不打挂整次读取', async (t) => {
  if (!(await isDbReachable())) { t.skip('DATABASE_URL is not reachable; skipping'); return; }
  const user = await makeUser('album-photo-profile-bad');
  try {
    const album = await makeAlbum(user.id);
    await db.transaction(async (tx) => {
      await albumPhotoRepo.upsertMany(tx, album.id, [
        { photoId: 'good', status: 'uploaded' },
        { photoId: 'bad', status: 'uploaded' },
      ]);
    });
    await albumPhotoRepo.setProfiles(album.id, { good: sampleProfile });
    // 直接用 raw SQL 塞一个形状不对的 jsonb(模拟契约演进后的旧数据)。
    await db.execute(sql`
      UPDATE album_photos SET profile = ${JSON.stringify({ v: 1, colorTemp: 'chartreuse' })}::jsonb
       WHERE album_id = ${album.id} AND photo_id = 'bad'
    `);

    const back = await albumPhotoRepo.findProfilesByAlbum(album.id);
    assert.deepEqual(PhotoProfileSchema.parse(back.good), sampleProfile);
    assert.equal(back.bad, undefined);
  } finally {
    await cleanupUser(user.id);
  }
});

test('albumPhotoRepo: 批量写多张只发一条语句', async (t) => {
  if (!(await isDbReachable())) { t.skip('DATABASE_URL is not reachable; skipping'); return; }
  const user = await makeUser('album-photo-profile-batch');
  try {
    const album = await makeAlbum(user.id);
    const photoIds = Array.from({ length: 20 }, (_, i) => `b${i}`);
    await db.transaction(async (tx) => {
      await albumPhotoRepo.upsertMany(
        tx,
        album.id,
        photoIds.map((photoId) => ({ photoId, status: 'uploaded' as const })),
      );
    });

    // 一本书上百张照片,逐条 UPDATE 是上百个 round trip。断言实现走的是**单条**
    // 批量语句 —— 用一个只计数、随后转发给真实实现的 tx 壳子来数。
    let executeCalls = 0;
    const countingTx = {
      execute: (...args: Parameters<typeof db.execute>) => {
        executeCalls += 1;
        return db.execute(...args);
      },
    } as unknown as typeof db;

    await albumPhotoRepo.setProfiles(
      album.id,
      Object.fromEntries(photoIds.map((photoId) => [photoId, sampleProfile])),
      countingTx,
    );
    assert.equal(executeCalls, 1, `20 张照片应只发 1 条语句,实际 ${executeCalls}`);

    const back = await albumPhotoRepo.findProfilesByAlbum(album.id);
    assert.equal(Object.keys(back).length, 20);
  } finally {
    await cleanupUser(user.id);
  }
});

test('albumPhotoRepo: setProfiles 空输入是 no-op,不发语句', async (t) => {
  if (!(await isDbReachable())) { t.skip('DATABASE_URL is not reachable; skipping'); return; }
  let executeCalls = 0;
  const countingTx = { execute: () => { executeCalls += 1; return Promise.resolve([]); } } as unknown as typeof db;
  await albumPhotoRepo.setProfiles('no-such-album', {}, countingTx);
  assert.equal(executeCalls, 0);
});
