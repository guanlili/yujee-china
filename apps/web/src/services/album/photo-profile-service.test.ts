import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '@/db/client';
import { albumPhotoRepo } from '@/db/repos/album-photo-repo';
import { cleanupUser, isDbReachable, makeAlbum, makeUser } from '@/db/repos/__test__/setup';
import { getPhotoProfiles, savePhotoProfiles } from './photo-profile-service';

// engine 建完档把结果送回来。这一层的承诺是**逐条校验**:engine 侧单张照片解析
// 异常是常态,整批拒会让整本书没档案。隐私红线由契约的 .strict() 执行 —— 带位置
// 字段的档案整条不要,不剥字段(剥了等于默许上游继续发)。

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

async function seedAlbum(suffix: string, photoIds: string[]) {
  const user = await makeUser(suffix);
  const album = await makeAlbum(user.id);
  if (photoIds.length > 0) {
    await db.transaction(async (tx) => {
      await albumPhotoRepo.upsertMany(
        tx,
        album.id,
        photoIds.map((photoId) => ({ photoId, status: 'uploaded' as const })),
      );
    });
  }
  return { userId: user.id, albumId: album.id };
}

test('savePhotoProfiles: 逐条校验,一条坏的不会让整批失败', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const { userId, albumId } = await seedAlbum('profile-svc-partial', ['good', 'bad']);
  try {
    const result = await savePhotoProfiles(albumId, {
      good: sampleProfile,
      bad: { v: 1, colorTemp: 'chartreuse' },
    });
    assert.deepEqual(result, { saved: 1, skipped: 1 });

    const back = await getPhotoProfiles(albumId);
    assert.deepEqual(back.good, sampleProfile);
    assert.equal(back.bad, undefined);
  } finally {
    await cleanupUser(userId);
  }
});

test('savePhotoProfiles: 带位置字段的档案整条拒收', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const { userId, albumId } = await seedAlbum('profile-svc-privacy', ['leaky']);
  try {
    const result = await savePhotoProfiles(albumId, {
      leaky: { ...sampleProfile, gps: '31.2,121.4' },
    });
    // 隐私红线:不是剥掉那个字段就收下,是整条不要。
    assert.deepEqual(result, { saved: 0, skipped: 1 });
    assert.deepEqual(await getPhotoProfiles(albumId), {});
  } finally {
    await cleanupUser(userId);
  }
});

test('savePhotoProfiles: 每个位置类字段都被拒(隐私红线逐一钉死)', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const keys = ['location', 'place', 'gps', 'lat', 'lng', 'latitude', 'longitude', 'coordinate', 'coordinates'];
  const { userId, albumId } = await seedAlbum('profile-svc-privacy-all', keys);
  try {
    for (const key of keys) {
      const result = await savePhotoProfiles(albumId, { [key]: { ...sampleProfile, [key]: 'anything' } });
      assert.deepEqual(result, { saved: 0, skipped: 1 }, `${key} 必须被拒 —— 隐私红线`);
    }
    assert.deepEqual(await getPhotoProfiles(albumId), {});
  } finally {
    await cleanupUser(userId);
  }
});

test('savePhotoProfiles: 空输入是合法的 no-op', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const { userId, albumId } = await seedAlbum('profile-svc-empty', []);
  try {
    assert.deepEqual(await savePhotoProfiles(albumId, {}), { saved: 0, skipped: 0 });
  } finally {
    await cleanupUser(userId);
  }
});

test('savePhotoProfiles: 非对象输入不抛,记 skipped', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const { userId, albumId } = await seedAlbum('profile-svc-nonsense', []);
  try {
    assert.deepEqual(await savePhotoProfiles(albumId, 'nonsense'), { saved: 0, skipped: 1 });
    assert.deepEqual(await savePhotoProfiles(albumId, null), { saved: 0, skipped: 1 });
    assert.deepEqual(await savePhotoProfiles(albumId, [sampleProfile]), { saved: 0, skipped: 1 });
  } finally {
    await cleanupUser(userId);
  }
});

test('getPhotoProfiles: 没建档的书返回空对象,不抛', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const { userId, albumId } = await seedAlbum('profile-svc-none', ['p1']);
  try {
    assert.deepEqual(await getPhotoProfiles(albumId), {});
  } finally {
    await cleanupUser(userId);
  }
});
