import { test } from 'node:test';
import assert from 'node:assert/strict';
import { env } from '@/lib/env';
import { db } from '@/db/client';
import { albumPhotoRepo } from '@/db/repos/album-photo-repo';
import { cleanupUser, isDbReachable, makeAlbum, makeUser } from '@/db/repos/__test__/setup';
import { POST } from './route';

// design-agent 的 look_at_photos 取图口。鉴权与 job-progress / agent-data /
// photo-profiles 同款:AGENT_SHARED_SECRET 的 Bearer。

function request(body: unknown, secret?: string): Request {
  return new Request('http://localhost/api/v3/internal/photo-bytes', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(secret ? { authorization: `Bearer ${secret}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function seed(suffix: string) {
  const user = await makeUser(suffix);
  const album = await makeAlbum(user.id);
  await db.transaction(async (tx) => {
    await albumPhotoRepo.upsertMany(tx, album.id, [{ photoId: 'p1', status: 'uploaded' }]);
  });
  return { userId: user.id, albumId: album.id };
}

test('没带 shared secret 一律 401', async () => {
  const res = await POST(request({ albumId: 'a', photoIds: ['p1'] }));
  assert.equal(res.status, 401);
});

test('带错 secret 也是 401', async () => {
  const res = await POST(request({ albumId: 'a', photoIds: ['p1'] }, 'wrong'));
  assert.equal(res.status, 401);
});

test('请求体形状不对时 400，不进 service', async () => {
  const res = await POST(request({ albumId: 'a' }, env.AGENT_SHARED_SECRET));
  assert.equal(res.status, 400);
});

test('夹带 r2Key 之类的未知键要被 strict 拒掉 —— 这个口不接受调用方指定对象', async () => {
  const res = await POST(
    request({ albumId: 'a', photoIds: ['p1'], r2Key: 'photo-originals/other/secret.jpg' }, env.AGENT_SHARED_SECRET),
  );
  assert.equal(res.status, 400);
});

test('鉴权通过后返回 { photos, skipped } 信封', async (t) => {
  if (!(await isDbReachable())) return t.skip('db unreachable');
  const { userId, albumId } = await seed('pbroute1');
  try {
    // 只问一张不属于本册的照片:归属闸在读 R2 之前就拦下,所以这条用例不依赖
    // 本机有没有配 R2 凭证(真的读字节那部分在 agent-photo-bytes.test.ts 里注入读取器测)。
    const res = await POST(request({ albumId, photoIds: ['ghost'] }, env.AGENT_SHARED_SECRET));
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; data: { photos: unknown[]; skipped: { reason: string }[] } };
    assert.equal(body.ok, true);
    assert.deepEqual(body.data.photos, []);
    assert.deepEqual(body.data.skipped, [{ photoId: 'ghost', reason: 'not-in-album' }]);
  } finally {
    await cleanupUser(userId);
  }
});

test('R2 读失败不吞 —— 凭证轮换/限流不能被翻译成「这张照片没有」', async (t) => {
  if (!(await isDbReachable())) return t.skip('db unreachable');
  const { userId, albumId } = await seed('pbroute2');
  try {
    // 本机没有 R2 凭证,读一张 status=uploaded 的照片必然抛 —— 抛出去(5xx)才是对的。
    const res = await POST(request({ albumId, photoIds: ['p1'] }, env.AGENT_SHARED_SECRET));
    assert.ok(res.status >= 500, `期望 5xx,收到 ${res.status}`);
  } finally {
    await cleanupUser(userId);
  }
});
