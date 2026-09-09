import { test } from 'node:test';
import assert from 'node:assert/strict';
import { env } from '@/lib/env';
import { db } from '@/db/client';
import { albumPhotoRepo } from '@/db/repos/album-photo-repo';
import { cleanupUser, isDbReachable, makeAlbum, makeUser } from '@/db/repos/__test__/setup';
import { getPhotoProfiles } from '@/services/album/photo-profile-service';
import { POST } from './route';

// engine 建完档回调这个口。internal:必须校验 AGENT_SHARED_SECRET(照 job-progress
// 同款鉴权),不自创。逐条校验交给 service —— 一条坏档案不让整批失败。

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

function post(payload: unknown, secret: string = env.AGENT_SHARED_SECRET) {
  return POST(
    new Request('http://web.test/api/v3/internal/photo-profiles', {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  );
}

async function seedAlbum(suffix: string, photoIds: string[]) {
  const user = await makeUser(suffix);
  const album = await makeAlbum(user.id);
  await db.transaction(async (tx) => {
    await albumPhotoRepo.upsertMany(
      tx,
      album.id,
      photoIds.map((photoId) => ({ photoId, status: 'uploaded' as const })),
    );
  });
  return { userId: user.id, albumId: album.id };
}

test('photo-profiles: 错的 shared secret 401', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const res = await post({ albumId: 'a', profiles: {} }, 'wrong');
  assert.equal(res.status, 401);
});

test('photo-profiles: 合法回调落库,返回 saved/skipped', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const { userId, albumId } = await seedAlbum('profile-route-ok', ['p1', 'p2']);
  try {
    const res = await post({
      albumId,
      profiles: { p1: sampleProfile, p2: { v: 1, colorTemp: 'chartreuse' } },
    });
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).data, { saved: 1, skipped: 1 });

    const back = await getPhotoProfiles(albumId);
    assert.deepEqual(back.p1, sampleProfile);
    assert.equal(back.p2, undefined);
  } finally {
    await cleanupUser(userId);
  }
});

test('photo-profiles: 带位置字段的档案整条拒收,库里不留痕', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const { userId, albumId } = await seedAlbum('profile-route-privacy', ['p1']);
  try {
    const res = await post({
      albumId,
      profiles: { p1: { ...sampleProfile, lat: 31.2 } },
    });
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).data, { saved: 0, skipped: 1 });
    assert.deepEqual(await getPhotoProfiles(albumId), {});
  } finally {
    await cleanupUser(userId);
  }
});

test('photo-profiles: 缺 albumId → 400', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const res = await post({ profiles: {} });
  assert.equal(res.status, 400);
});

test('photo-profiles: 信封里的未知键 → 400(与其它 internal 口同强度)', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const res = await post({ albumId: 'a', profiles: {}, gps: '31.2,121.4' });
  assert.equal(res.status, 400);
});

test('photo-profiles: 空 profiles 是合法 no-op', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const { userId, albumId } = await seedAlbum('profile-route-empty', ['p1']);
  try {
    const res = await post({ albumId, profiles: {} });
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).data, { saved: 0, skipped: 0 });
  } finally {
    await cleanupUser(userId);
  }
});
