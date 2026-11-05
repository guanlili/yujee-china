import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { db } from '@/db/client';
import { sessions } from '@/db/schema';
import { cleanupUser, isDbReachable, makeAlbum, makeUser } from '@/db/repos/__test__/setup';
import { env } from '@/lib/env';
import { AlbumPatchSchema } from './schema';
import { GET, PATCH } from './route';

const here = dirname(fileURLToPath(import.meta.url));
const routeSource = readFileSync(join(here, 'route.ts'), 'utf8');

test('album PATCH delegates photoFilter updates without letting sibling fields be dropped', () => {
  assert.match(routeSource, /AlbumPatchSchema/);
  assert.match(routeSource, /body\.photoFilter !== undefined/);
  assert.match(routeSource, /const \{ baseSettingsRevision \} = body/);
  assert.match(
    routeSource,
    /albumService\.updatePhotoFilter\(userId, uuid, body\.photoFilter, baseSettingsRevision\)/,
  );

  const photoFilter = {
    default: { lutId: 'fuji-portrait' as const, strength: 80 },
  };
  assert.deepEqual(AlbumPatchSchema.parse({ photoFilter, baseSettingsRevision: 0 }), {
    photoFilter,
    baseSettingsRevision: 0,
  });
  assert.deepEqual(AlbumPatchSchema.parse({ photoFilter: null, baseSettingsRevision: 3 }), {
    photoFilter: null,
    baseSettingsRevision: 3,
  });

  // 全局创作设置 OCC(Phase 2B):baseSettingsRevision 给了就必须合法,**省略是发布
  // 阶段 A 的过渡态** —— 主站前端尚未发这个字段,必填会让 owner 自己改书名/背景/
  // 滤镜全部 400。省略时 owner 走旧盲写、editor 由 service 拒(见 collab OCC 用例)。
  assert.equal(AlbumPatchSchema.safeParse({ photoFilter }).success, true);
  assert.equal(AlbumPatchSchema.safeParse({ photoFilter, baseSettingsRevision: -1 }).success, false);
  assert.equal(AlbumPatchSchema.safeParse({ photoFilter, baseSettingsRevision: 0.5 }).success, false);
  assert.equal(AlbumPatchSchema.safeParse({}).success, false);
  assert.equal(
    AlbumPatchSchema.safeParse({ title: 'Kept', boardBackground: null, baseSettingsRevision: 0 })
      .success,
    false,
  );
  assert.equal(
    AlbumPatchSchema.safeParse({ title: 'Kept', photoFilter, baseSettingsRevision: 0 }).success,
    false,
  );
  assert.equal(
    AlbumPatchSchema.safeParse({ boardBackground: null, photoFilter, baseSettingsRevision: 0 })
      .success,
    false,
  );
});

// ─── 多租户路由层直接集成测试(P1 盲区)─────────────────────────────────────
// 不做源码字符串断言,而是真起两个用户、真落 A 的相册、真签 better-auth
// session cookie,直接调 route handler。验证「B 拿自己 session 读/改 A 的相册」
// 被路由层的鉴权+协作访问控制挡住,且 A 本人能正常读写(证明链路本身没断)。
//
// 语义以代码为准(见 collaboration-service.requireAccess / lockAlbumForSettingsWrite):
//   - 相册存在但 B 既不是 owner 也不是 editor → ALBUM_ACCESS_DENIED = 403
//     (不是 404:相册存在,只是 B 无权;404 只给「相册不存在」)。
//   - GET 走 requireAccess,PATCH(title)走 lockAlbumForSettingsWrite,同一道闸。
//
// session cookie 是 better-call 的 signed cookie:`<token>.<base64-HMAC-SHA256(token,
// BETTER_AUTH_SECRET)>`,解析时最后一个 '.' 切段、验签(44 字符、以 '=' 结尾)。
// token 直接写 sessions 表(better-auth 1.7.12 存的是原始 token,findSession 按
// token 等值查,不 hash)。无 DB 时整组由 isDbReachable 守卫 skip,CI 真跑。

async function mintSessionCookie(userId: string): Promise<string> {
  const token = `${randomUUID()}${randomUUID()}`.replace(/-/g, '');
  await db.insert(sessions).values({
    userId,
    token,
    expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
  });
  const sig = createHmac('sha256', env.BETTER_AUTH_SECRET).update(token).digest('base64');
  return `better-auth.session_token=${encodeURIComponent(`${token}.${sig}`)}`;
}

function authedReq(cookie: string, uuid: string, method: 'GET' | 'PATCH' = 'GET', body?: unknown) {
  return new Request(`http://web.test/api/v1/albums/${uuid}`, {
    method,
    headers: { cookie, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

async function seedTenantPair() {
  const owner = await makeUser('tenant-owner');
  const stranger = await makeUser('tenant-stranger');
  const album = await makeAlbum(owner.id, { title: 'A Private Book' });
  const ownerCookie = await mintSessionCookie(owner.id);
  const strangerCookie = await mintSessionCookie(stranger.id);
  return { owner, stranger, album, ownerCookie, strangerCookie };
}

test('multi-tenant: 陌生人 GET 别人的相册 → 403(不是 404)', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const { owner, stranger, album, strangerCookie } = await seedTenantPair();
  try {
    const res = await GET(authedReq(strangerCookie, album.id), {
      params: Promise.resolve({ uuid: album.id }),
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error?.code, 'ALBUM_ACCESS_DENIED');
  } finally {
    await cleanupUser(owner.id);
    await cleanupUser(stranger.id);
  }
});

test('multi-tenant: 陌生人 PATCH(改书名)别人的相册 → 403,不写库', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const { owner, stranger, album, strangerCookie } = await seedTenantPair();
  try {
    const res = await PATCH(
      authedReq(strangerCookie, album.id, 'PATCH', { title: 'Hijacked' }),
      { params: Promise.resolve({ uuid: album.id }) },
    );
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error?.code, 'ALBUM_ACCESS_DENIED');

    // 对照组反向:owner 自己读回,标题没变(证明 PATCH 被拒、没落到库)。
    const back = await GET(authedReq(await mintSessionCookie(owner.id), album.id), {
      params: Promise.resolve({ uuid: album.id }),
    });
    assert.equal(back.status, 200);
    assert.equal((await back.json()).data.album.title, 'A Private Book');
  } finally {
    await cleanupUser(owner.id);
    await cleanupUser(stranger.id);
  }
});

test('multi-tenant: 属主自己 GET 自己的相册 → 200(证明测试链路有效)', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const { owner, stranger, album, ownerCookie } = await seedTenantPair();
  try {
    const res = await GET(authedReq(ownerCookie, album.id), {
      params: Promise.resolve({ uuid: album.id }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.album.id, album.id);
    assert.equal(body.data.album.title, 'A Private Book');
    assert.equal(body.data.album.role, 'owner');
  } finally {
    await cleanupUser(owner.id);
    await cleanupUser(stranger.id);
  }
});
