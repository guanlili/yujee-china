import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '@/db/client';
import { albumPhotoRepo } from '@/db/repos/album-photo-repo';
import { cleanupUser, isDbReachable, makeAlbum, makeUser } from '@/db/repos/__test__/setup';
import {
  AGENT_PHOTO_BYTES_MAX,
  AGENT_PHOTO_MAX_BYTES,
  AGENT_PHOTO_TOTAL_BASE64_BYTES,
  base64Length,
  getAgentPhotoBytes,
} from './agent-photo-bytes';

/**
 * design-agent 的 look_at_photos 取图 seam(web 这一半)。
 *
 * 归属校验靠 album_photos:请求只带 albumId + photoId,**R2 key 由服务端推导** ——
 * 收 key 会让 AGENT_SHARED_SECRET 变成整桶任意对象的读取钥匙。
 */

const bytes = (size: number, fill = 7) => new Uint8Array(size).fill(fill);

async function seed(suffix: string) {
  const user = await makeUser(suffix);
  const album = await makeAlbum(user.id);
  await db.transaction(async (tx) => {
    await albumPhotoRepo.upsertMany(tx, album.id, [
      { photoId: 'p1', status: 'uploaded' },
      { photoId: 'p2', status: 'uploaded' },
      { photoId: 'p3', status: 'missing' },
      { photoId: 'p4', status: 'uploaded' },
    ]);
  });
  return { userId: user.id, albumId: album.id };
}

test('取回照片字节:base64 + mimeType', async (t) => {
  if (!(await isDbReachable())) return t.skip('db unreachable');
  const { userId, albumId } = await seed('apb1');
  try {
    const result = await getAgentPhotoBytes(albumId, ['p1'], {
      readObject: async () => bytes(10),
    });
    assert.equal(result.photos.length, 1);
    assert.equal(result.photos[0]!.photoId, 'p1');
    assert.equal(result.photos[0]!.mimeType, 'image/jpeg');
    assert.equal(Buffer.from(result.photos[0]!.data, 'base64').length, 10);
  } finally {
    await cleanupUser(userId);
  }
});

test('R2 key 由 (albumId, photoId) 推导，调用方给不了 key', async (t) => {
  if (!(await isDbReachable())) return t.skip('db unreachable');
  const { userId, albumId } = await seed('apb2');
  const keys: string[] = [];
  try {
    await getAgentPhotoBytes(albumId, ['p1'], {
      readObject: async (key) => {
        keys.push(key);
        return bytes(10);
      },
    });
    assert.deepEqual(keys, [`photo-originals/${albumId}/p1.jpg`]);
  } finally {
    await cleanupUser(userId);
  }
});

test('不属于这本相册的 photoId 一律拒读 —— 这是这个口唯一的归属闸', async (t) => {
  if (!(await isDbReachable())) return t.skip('db unreachable');
  const { userId, albumId } = await seed('apb3');
  const keys: string[] = [];
  try {
    const result = await getAgentPhotoBytes(albumId, ['ghost'], {
      readObject: async (key) => {
        keys.push(key);
        return bytes(10);
      },
    });
    assert.equal(result.photos.length, 0);
    assert.equal(result.skipped[0]?.reason, 'not-in-album');
    assert.deepEqual(keys, [], '越权 photoId 连 R2 都不该碰一下');
  } finally {
    await cleanupUser(userId);
  }
});

test('status=missing 的照片跳过，不去读一个必然不存在的对象', async (t) => {
  if (!(await isDbReachable())) return t.skip('db unreachable');
  const { userId, albumId } = await seed('apb4');
  const keys: string[] = [];
  try {
    const result = await getAgentPhotoBytes(albumId, ['p3'], {
      readObject: async (key) => {
        keys.push(key);
        return bytes(10);
      },
    });
    assert.equal(result.skipped[0]?.reason, 'not-uploaded');
    assert.deepEqual(keys, []);
  } finally {
    await cleanupUser(userId);
  }
});

test('R2 里没有对象时记 missing-object，其余照片照常返回', async (t) => {
  if (!(await isDbReachable())) return t.skip('db unreachable');
  const { userId, albumId } = await seed('apb5');
  try {
    const result = await getAgentPhotoBytes(albumId, ['p1', 'p2'], {
      readObject: async (key) => (key.endsWith('p1.jpg') ? null : bytes(10)),
    });
    assert.deepEqual(result.photos.map((p) => p.photoId), ['p2']);
    assert.deepEqual(result.skipped, [{ photoId: 'p1', reason: 'missing-object' }]);
  } finally {
    await cleanupUser(userId);
  }
});

test('单张超上限跳过 —— 一张巨图能把整个模型请求顶爆', async (t) => {
  if (!(await isDbReachable())) return t.skip('db unreachable');
  const { userId, albumId } = await seed('apb6');
  try {
    const result = await getAgentPhotoBytes(albumId, ['p1', 'p2'], {
      readObject: async (key) => (key.endsWith('p1.jpg') ? bytes(AGENT_PHOTO_MAX_BYTES + 1) : bytes(10)),
    });
    assert.deepEqual(result.skipped, [{ photoId: 'p1', reason: 'too-large' }]);
    assert.deepEqual(result.photos.map((p) => p.photoId), ['p2']);
  } finally {
    await cleanupUser(userId);
  }
});

test('累计超总预算后停手，剩下的记 over-budget', async (t) => {
  if (!(await isDbReachable())) return t.skip('db unreachable');
  const { userId, albumId } = await seed('apb7');
  try {
    // 每张都顶到单张上限:前两张吃满总预算,第三张放不下。
    const result = await getAgentPhotoBytes(albumId, ['p1', 'p2', 'p4'], {
      readObject: async () => bytes(AGENT_PHOTO_MAX_BYTES),
    });
    // 预算与判定都在 base64 口径上,所以这里的算术也按编码后算。
    const perPhoto = base64Length(AGENT_PHOTO_MAX_BYTES);
    const fits = Math.floor(AGENT_PHOTO_TOTAL_BASE64_BYTES / perPhoto);
    assert.ok(fits >= 1 && fits < 3, `预算常量变了就把这条用例的算术一起改(fits=${fits})`);
    assert.deepEqual(result.photos.map((p) => p.photoId), ['p1', 'p2', 'p4'].slice(0, fits));
    assert.deepEqual(
      result.skipped,
      ['p1', 'p2', 'p4'].slice(fits).map((photoId) => ({ photoId, reason: 'over-budget' })),
    );
  } finally {
    await cleanupUser(userId);
  }
});

test('超过张数上限直接拒 —— 与 look_at_photos 的 6 张同口径', async (t) => {
  if (!(await isDbReachable())) return t.skip('db unreachable');
  const { userId, albumId } = await seed('apb8');
  try {
    const tooMany = Array.from({ length: AGENT_PHOTO_BYTES_MAX + 1 }, (_, i) => `p${i}`);
    await assert.rejects(() => getAgentPhotoBytes(albumId, tooMany, { readObject: async () => bytes(10) }));
  } finally {
    await cleanupUser(userId);
  }
});

test('空清单直接拒', async (t) => {
  if (!(await isDbReachable())) return t.skip('db unreachable');
  const { userId, albumId } = await seed('apb9');
  try {
    await assert.rejects(() => getAgentPhotoBytes(albumId, [], { readObject: async () => bytes(10) }));
  } finally {
    await cleanupUser(userId);
  }
});

test('同一张重复请求只读一次 R2', async (t) => {
  if (!(await isDbReachable())) return t.skip('db unreachable');
  const { userId, albumId } = await seed('apb10');
  let reads = 0;
  try {
    const result = await getAgentPhotoBytes(albumId, ['p1', 'p1'], {
      readObject: async () => {
        reads += 1;
        return bytes(10);
      },
    });
    assert.equal(reads, 1);
    assert.equal(result.photos.length, 1);
  } finally {
    await cleanupUser(userId);
  }
});

// ── 响应体不能顶穿 Vercel 的 4.5MB ────────────────────────────────────────
// 这个口用普通 JSON 返回 base64(膨胀 ×4/3)。预算按**原始**字节算的话,取满就是
// 8MB 响应体 → 整次 500,不是「跳过几张」,是兜底路径直接废。
const VERCEL_RESPONSE_BODY_LIMIT = 4.5 * 1024 * 1024;

/** 路由实际发出去的那层信封(handler 走 ok(result))。 */
const responseBodySize = (result: unknown) =>
  Buffer.byteLength(JSON.stringify({ ok: true, data: result }), 'utf8');

test('取满预算时响应体仍在 Vercel 4.5MB 之下(留足余量)', async (t) => {
  if (!(await isDbReachable())) return t.skip('db unreachable');
  const { userId, albumId } = await seed('apb-budget');
  try {
    // 六张都顶到单张上限 —— 最坏情况。
    const result = await getAgentPhotoBytes(albumId, ['p1', 'p2', 'p4'], {
      readObject: async () => bytes(AGENT_PHOTO_MAX_BYTES),
    });
    const size = responseBodySize(result);
    assert.ok(
      size < VERCEL_RESPONSE_BODY_LIMIT,
      `响应体 ${size} 字节已经超过 Vercel 的 ${VERCEL_RESPONSE_BODY_LIMIT}`,
    );
    assert.ok(result.photos.length >= 1, '预算再紧也得让第一张过去,否则这条路等于没有');
  } finally {
    await cleanupUser(userId);
  }
});

test('单张顶到上限时,一张就把响应体撑爆也不行', async (t) => {
  if (!(await isDbReachable())) return t.skip('db unreachable');
  const { userId, albumId } = await seed('apb-budget-single');
  try {
    const result = await getAgentPhotoBytes(albumId, ['p1'], {
      readObject: async () => bytes(AGENT_PHOTO_MAX_BYTES),
    });
    assert.ok(responseBodySize(result) < VERCEL_RESPONSE_BODY_LIMIT);
  } finally {
    await cleanupUser(userId);
  }
});
