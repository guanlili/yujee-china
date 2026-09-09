import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PhotoProfile } from '@yujee/contracts';
import { db } from '@/db/client';
import { albumPhotoRepo } from '@/db/repos/album-photo-repo';
import { cleanupUser, isDbReachable, makeAlbum, makeUser } from '@/db/repos/__test__/setup';
import { getPhotoProfiles } from './photo-profile-service';
import { PHOTO_MASK_MAX_PER_RUN, ensureCutoutMasks, getCutoutMaskUrls } from './photo-mask-service';

/**
 * 抠图渲染必须用**服务端分割 mask**,不能用浏览器端的漫水填充 —— 后者没有语义,
 * 2026-08-29 实测「棚拍人像 5 张 0 张能用」,自动抠图因此被否决。Agent 现在能自动
 * 开抠图,不接这条路等于给用户一个被啃残的自己。
 *
 * 这一层的承诺:**尽力而为,绝不抛**。拿不到 mask 只是退回浏览器端抠图,不能让
 * 「调色/抠图这轮对话」整轮失败。
 */

const P1 = '550e8400-e29b-41d4-a716-4466554400b1';
const P2 = '550e8400-e29b-41d4-a716-4466554400b2';

const baseProfile: PhotoProfile = {
  v: 1,
  subjectBox: { x: 10, y: 10, w: 40, h: 40 },
  faceBoxes: [],
  maskKey: null,
  colorTemp: 'neutral',
  brightness: 'mid',
  saturation: 'normal',
  dominantColors: [],
  composition: 'focal',
  scene: 'outdoor',
  peopleCount: '1',
  mood: 'quiet',
  description: '一个人',
};

const MASK_B64 = Buffer.from('fake-png-bytes').toString('base64');

async function seed(suffix: string, photoIds: string[]) {
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

function deps(over: Record<string, unknown> = {}) {
  const state = {
    put: [] as { key: string; bytes: number; contentType: string }[],
    asked: [] as string[][],
    read: [] as string[],
  };
  return {
    state,
    value: {
      readOriginal: async (key: string) => {
        state.read.push(key);
        return new Uint8Array([1, 2, 3]);
      },
      requestMasks: async (images: { photoId: string }[]) => {
        state.asked.push(images.map((i) => i.photoId));
        return { profiles: {}, masks: Object.fromEntries(images.map((i) => [i.photoId, MASK_B64])) };
      },
      putObject: async (key: string, bytes: Uint8Array, contentType: string) => {
        state.put.push({ key, bytes: bytes.byteLength, contentType });
      },
      ...over,
    },
  };
}

test('ensureCutoutMasks: mask 写进 R2 并把 maskKey 回填到档案', async (t) => {
  if (!(await isDbReachable())) return t.skip('db unreachable');
  const { userId, albumId } = await seed('mask-basic', [P1]);
  const d = deps();
  try {
    await albumPhotoRepo.setProfiles(albumId, { [P1]: baseProfile });

    const result = await ensureCutoutMasks(albumId, [P1], d.value);

    assert.deepEqual(result.created, [P1]);
    assert.deepEqual(d.state.put, [{
      key: `photo-masks/${albumId}/${P1}.png`,
      bytes: Buffer.from(MASK_B64, 'base64').byteLength,
      contentType: 'image/png',
    }]);
    const profiles = await getPhotoProfiles(albumId);
    assert.equal(profiles[P1]?.maskKey, `photo-masks/${albumId}/${P1}.png`);
    // 其余档案字段一个字节都不许动。
    assert.equal(profiles[P1]?.description, baseProfile.description);
    assert.deepEqual(profiles[P1]?.subjectBox, baseProfile.subjectBox);
  } finally {
    await cleanupUser(userId);
  }
});

test('ensureCutoutMasks: 已经有 maskKey 的照片不重跑推理', async (t) => {
  if (!(await isDbReachable())) return t.skip('db unreachable');
  const { userId, albumId } = await seed('mask-skip', [P1]);
  const d = deps();
  try {
    await albumPhotoRepo.setProfiles(albumId, {
      [P1]: { ...baseProfile, maskKey: `photo-masks/${albumId}/${P1}.png` },
    });
    const result = await ensureCutoutMasks(albumId, [P1], d.value);
    assert.deepEqual(result.created, []);
    assert.equal(d.state.asked.length, 0, '有 mask 就不该再烧一次 4 秒的推理');
    assert.equal(d.state.read.length, 0);
  } finally {
    await cleanupUser(userId);
  }
});

test('ensureCutoutMasks: 还没建档的照片也能补出 mask(档案从这次推理里取)', async (t) => {
  if (!(await isDbReachable())) return t.skip('db unreachable');
  const { userId, albumId } = await seed('mask-noprofile', [P1]);
  const d = deps({
    requestMasks: async (images: { photoId: string }[]) => ({
      profiles: Object.fromEntries(images.map((i) => [i.photoId, baseProfile])),
      masks: Object.fromEntries(images.map((i) => [i.photoId, MASK_B64])),
    }),
  });
  try {
    const result = await ensureCutoutMasks(albumId, [P1], d.value);
    assert.deepEqual(result.created, [P1]);
    const profiles = await getPhotoProfiles(albumId);
    assert.equal(profiles[P1]?.maskKey, `photo-masks/${albumId}/${P1}.png`);
    assert.equal(profiles[P1]?.description, baseProfile.description);
  } finally {
    await cleanupUser(userId);
  }
});

test('ensureCutoutMasks: 推理失败不抛,只是没 mask(渲染退回浏览器端)', async (t) => {
  if (!(await isDbReachable())) return t.skip('db unreachable');
  const { userId, albumId } = await seed('mask-fail', [P1]);
  const d = deps({ requestMasks: async () => { throw new Error('clip worker down'); } });
  try {
    await albumPhotoRepo.setProfiles(albumId, { [P1]: baseProfile });
    const result = await ensureCutoutMasks(albumId, [P1], d.value);
    assert.deepEqual(result.created, []);
    assert.equal((await getPhotoProfiles(albumId))[P1]?.maskKey, null, '失败不许留半截状态');
  } finally {
    await cleanupUser(userId);
  }
});

test('ensureCutoutMasks: 写 R2 失败时不回填 maskKey —— 指向一个不存在的对象比没有更糟', async (t) => {
  if (!(await isDbReachable())) return t.skip('db unreachable');
  const { userId, albumId } = await seed('mask-put-fail', [P1]);
  const d = deps({ putObject: async () => { throw new Error('r2 down'); } });
  try {
    await albumPhotoRepo.setProfiles(albumId, { [P1]: baseProfile });
    const result = await ensureCutoutMasks(albumId, [P1], d.value);
    assert.deepEqual(result.created, []);
    assert.equal((await getPhotoProfiles(albumId))[P1]?.maskKey, null);
  } finally {
    await cleanupUser(userId);
  }
});

test('ensureCutoutMasks: 不在这本相册 / 原图没上传的照片一律不碰', async (t) => {
  if (!(await isDbReachable())) return t.skip('db unreachable');
  const { userId, albumId } = await seed('mask-ownership', [P1]);
  await db.transaction(async (tx) => {
    await albumPhotoRepo.upsertMany(tx, albumId, [{ photoId: P2, status: 'missing' }]);
  });
  const d = deps();
  try {
    await ensureCutoutMasks(albumId, [P2, 'not-in-this-album'], d.value);
    assert.equal(d.state.asked.length, 0);
    assert.equal(d.state.read.length, 0, '归属闸没过就连 R2 都不该碰');
  } finally {
    await cleanupUser(userId);
  }
});

test('ensureCutoutMasks: 一轮最多跑几张 —— 推理是 CPU 上的 4 秒/张,不能顶穿函数预算', async (t) => {
  if (!(await isDbReachable())) return t.skip('db unreachable');
  const many = Array.from({ length: PHOTO_MASK_MAX_PER_RUN + 3 }, (_, i) =>
    `550e8400-e29b-41d4-a716-4466554400${(0x10 + i).toString(16)}`);
  const { userId, albumId } = await seed('mask-cap', many);
  const d = deps();
  try {
    await albumPhotoRepo.setProfiles(
      albumId,
      Object.fromEntries(many.map((photoId) => [photoId, baseProfile])),
    );
    const result = await ensureCutoutMasks(albumId, many, d.value);
    assert.equal(result.created.length, PHOTO_MASK_MAX_PER_RUN);
    // 没跑到的下一轮还会再来(判据是「现在开着抠图但还没 maskKey」,不是「刚开的那几张」)。
    assert.equal(result.deferred, 3);
  } finally {
    await cleanupUser(userId);
  }
});

test('ensureCutoutMasks: 空清单是零成本空转', async (t) => {
  if (!(await isDbReachable())) return t.skip('db unreachable');
  const { userId, albumId } = await seed('mask-empty', [P1]);
  const d = deps();
  try {
    assert.deepEqual((await ensureCutoutMasks(albumId, [], d.value)).created, []);
    assert.equal(d.state.asked.length, 0);
  } finally {
    await cleanupUser(userId);
  }
});

// ── 渲染侧取 mask 的签名 URL ───────────────────────────────────────────────
test('getCutoutMaskUrls: 只有真有 maskKey 的照片出 URL,其余键干脆不出现', async (t) => {
  if (!(await isDbReachable())) return t.skip('db unreachable');
  const { userId, albumId } = await seed('mask-urls', [P1, P2]);
  try {
    await albumPhotoRepo.setProfiles(albumId, {
      [P1]: { ...baseProfile, maskKey: `photo-masks/${albumId}/${P1}.png` },
      [P2]: baseProfile,
    });
    const signed: string[] = [];
    const out = await getCutoutMaskUrls(userId, albumId, [P1, P2], {
      signUrl: async (key) => { signed.push(key); return `https://r2.test/${key}?sig=1`; },
    });
    assert.deepEqual(Object.keys(out), [P1]);
    assert.deepEqual(signed, [`photo-masks/${albumId}/${P1}.png`]);
    assert.equal(out[P2], undefined, '没有 mask 的照片必须缺席 —— 浏览器据此退回自己那套');
  } finally {
    await cleanupUser(userId);
  }
});

test('getCutoutMaskUrls: 非成员一律拒(归属走 requireAccess,不是自己判 userId)', async (t) => {
  if (!(await isDbReachable())) return t.skip('db unreachable');
  const { userId, albumId } = await seed('mask-urls-denied', [P1]);
  const stranger = await makeUser('mask-urls-stranger');
  try {
    await assert.rejects(
      () => getCutoutMaskUrls(stranger.id, albumId, [P1], { signUrl: async (k) => k }),
      (err: unknown) => (err as { code?: string }).code === 'ALBUM_ACCESS_DENIED',
    );
  } finally {
    await cleanupUser(stranger.id);
    await cleanupUser(userId);
  }
});

test('getCutoutMaskUrls: 别的相册的 photoId 问不出 URL', async (t) => {
  if (!(await isDbReachable())) return t.skip('db unreachable');
  const { userId, albumId } = await seed('mask-urls-scope', [P1]);
  const other = await seed('mask-urls-scope-2', [P2]);
  try {
    await albumPhotoRepo.setProfiles(other.albumId, {
      [P2]: { ...baseProfile, maskKey: `photo-masks/${other.albumId}/${P2}.png` },
    });
    const out = await getCutoutMaskUrls(userId, albumId, [P2], { signUrl: async (k) => k });
    assert.deepEqual(out, {});
  } finally {
    await cleanupUser(other.userId);
    await cleanupUser(userId);
  }
});
