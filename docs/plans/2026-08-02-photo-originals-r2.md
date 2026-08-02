# 照片真相迁 R2(Phase 0)实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 照片规范原图落 R2 成为真相源,浏览器 IndexedDB 降级为缓存;换设备不丢图,为共同编辑(Phase 1)铺路。

**Architecture:** 新表 `album_photos` 登记每册每张照片的原图状态(uploaded/missing);新 R2 前缀 `photo-originals/{albumId}/{photoId}.jpg` 存**无滤镜**打印级 JPEG(长边 3400 / q0.82,与现有 backup 档同参);上传复用 presign PUT → 直传 → confirm 落库的既有三段式;读取新增 presigned GET(私有读,全仓首个)。浏览器侧只改一个咽喉点:`photoStore.getBlob` 本地 miss 时经注入的 remote fetcher 从 R2 拉原图回填缓存,其余派生档/滤镜/PDF 链路自动痊愈。存量补传走「编辑器加载时对账」:算出书内 photoId 与服务端登记的差集,后台幂等补传。**photo-snapshots 分享快照链路原样保留,零改动;engine 与 design-agent 零改动。**

**Tech Stack:** Next.js 15 route handlers · Drizzle + Postgres · @aws-sdk/client-s3 presigner · node:test + tsx(web 包不用 vitest)· 设计文档 `docs/specs/2026-08-02-collab-editing-design.md`(Phase 0 章)

## Global Constraints

- 测试跑法:单文件 `pnpm --filter @yujee/web exec tsx --test <file>`;全包 `pnpm --filter @yujee/web test`。DB 集成测试用 `isDbReachable()` skip 惯例(`src/db/repos/__test__/setup.ts`)。
- **凡 import 链碰到 `src/lib/env.ts` 的测试**,必须在文件顶部先 `process.env.R2_ACCOUNT_ID ??= 'test-account'` 等预置 env,再用顶层 `await import()` 动态引业务模块(照抄 `src/services/album/photo-snapshot-flow.test.ts:1-18`)。
- 逐任务只跑 `pnpm --filter @yujee/web typecheck`;仓根 `pnpm typecheck`(含 docs:check)**只在 Task 9 文档更新后跑**——中途跑必因 doc-scope checked-at 未推进而红,这是预期。
- R2 client 必须保持 `requestChecksumCalculation/responseChecksumValidation: 'WHEN_REQUIRED'`(`src/lib/r2/r2-client.ts:27-28`);新增 presign 测试都要断言 URL 不含 `x-amz-checksum`。
- 规范原图 = **无滤镜基图**字节,长边 `TIER_MAX_EDGE.backup`(3400)、质量 `TIER_QUALITY.backup`(0.82)、`image/jpeg`。绝不带 LUT 上传。
- photoId 合法性一律用 `isValidPhotoId`(`src/services/album/photo-snapshot-util.ts:14`);IndexedDB `originals` store 里 `boardbg-` 前缀的 key 是画板背景不是照片,任何上传/远端回退都必须排除。
- confirm 端服务器**重推 key 等值比对**,绝不信任客户端 r2Key;presign TTL 一律 300 秒;单批上限 300 张。
- **在途脏文件警戒**:`MobileEditorRoot.tsx`、`MoreSheet.tsx`、design-agent 若干文件是用户并行工作,动它们之前先 `git diff` 看清、做最小插入、绝不回滚用户改动;`git add` 只加本任务文件,禁止 `git add -A`。
- 每个 commit 结尾加 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。

## 文件结构

**新建**
- `apps/web/src/services/album/photo-original-util.ts`(+ `.test.ts`) — 纯函数:key 推导、zod schema、常量
- `apps/web/src/db/repos/album-photo-repo.ts`(+ `.test.ts`) — album_photos repo
- `apps/web/src/services/album/photo-original-service.ts`(+ `photo-original-flow.test.ts`) — sign/confirm/getUrls
- `apps/web/src/app/api/v1/albums/[uuid]/photo-originals/upload-url/route.ts`
- `apps/web/src/app/api/v1/albums/[uuid]/photo-originals/route.ts`(confirm)
- `apps/web/src/app/api/v1/albums/[uuid]/photo-originals/urls/route.ts`
- `apps/web/src/lib/album/photo-original-client.ts` — 浏览器封装
- `apps/web/src/lib/album/photo-original-sync.ts`(+ `.test.ts`) — 对账补传
- `apps/web/src/lib/hooks/use-photo-original-sync.ts` — 编辑器挂载 hook

**修改**
- `apps/web/src/lib/r2/r2-client.ts`(+ `r2-presign.test.ts`) — 加 `signGetUrl`
- `apps/web/src/db/schema.ts` + `src/db/migrations/`(db:generate) — album_photos 表
- `apps/web/src/db/repos/__test__/setup.ts` — cleanupUser 补删 album_photos
- `apps/web/src/services/album/album-service.ts` — delete 级联 + getDetail 投影
- `apps/web/src/lib/photo/store.ts`(+ `store.test.ts`) — remote fetcher 回退 + 规范原图导出
- `apps/web/src/components/album/EditorPort.tsx`、`.../mobile/MobileEditorRoot.tsx`(脏文件,最小插入) — 接线
- `README.md`、`CLAUDE.md`、`apps/web/README.md` — 照片边界改写 + checked-at

---

### Task 1: R2 presigned GET 能力

**Files:**
- Modify: `apps/web/src/lib/r2/r2-client.ts`
- Test: `apps/web/src/lib/r2/r2-presign.test.ts`(追加用例)

**Interfaces:**
- Consumes: 现有 `client()` 单例、`env.R2_BUCKET`、`ERRORS.R2_SIGN_FAILED`
- Produces: `r2.signGetUrl(key: string, expiresInSeconds = 300): Promise<string>` — 后续 Task 4 消费

- [ ] **Step 1: 写失败测试** — 在 `r2-presign.test.ts` 现有 env 预置之后追加:

```ts
test('signGetUrl presigns a private read without checksum params', async () => {
  const url = await r2.signGetUrl('photo-originals/album-1/photo-1.jpg', 60);
  assert.match(url, /X-Amz-Signature=/);
  assert.match(url, /photo-originals\/album-1\/photo-1\.jpg/);
  assert.doesNotMatch(url, /x-amz-checksum/i);
  assert.doesNotMatch(url, /x-amz-sdk-checksum/i);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @yujee/web exec tsx --test src/lib/r2/r2-presign.test.ts`
Expected: FAIL,`r2.signGetUrl is not a function`

- [ ] **Step 3: 实现** — `r2-client.ts` 里镜像 `signPutUrl` 的形状:import `GetObjectCommand`,`r2` 对象追加

```ts
async signGetUrl(key: string, expiresInSeconds = 300): Promise<string> {
  try {
    const command = new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: key });
    return await getSignedUrl(client(), command, { expiresIn: expiresInSeconds });
  } catch {
    throw ERRORS.R2_SIGN_FAILED();
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @yujee/web exec tsx --test src/lib/r2/r2-presign.test.ts && pnpm --filter @yujee/web typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/r2/r2-client.ts apps/web/src/lib/r2/r2-presign.test.ts
git commit -m "feat(web): R2 presigned GET(signGetUrl)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: album_photos 表 + repo + 级联清理

**Files:**
- Modify: `apps/web/src/db/schema.ts`、`apps/web/src/db/repos/__test__/setup.ts`、`apps/web/src/services/album/album-service.ts`(仅 `delete` 方法)
- Create: `apps/web/src/db/repos/album-photo-repo.ts`、`apps/web/src/db/migrations/`(db:generate 产物)
- Test: `apps/web/src/db/repos/album-photo-repo.test.ts`

**Interfaces:**
- Consumes: `DbOrTx`(`src/db/client.ts`)、`albums` 表、`albumPages` 的 albumId 列/FK 写法(逐字镜像其类型与 onDelete 配置)
- Produces(Task 4/5 消费):

```ts
export type AlbumPhotoUpsert = { photoId: string; status: 'uploaded' | 'missing'; width?: number; height?: number; bytes?: number };
export const albumPhotoRepo = {
  findByAlbum: (albumId: string) => Promise<AlbumPhoto[]>,            // 读,非事务
  upsertMany: (tx: DbOrTx, albumId: string, rows: AlbumPhotoUpsert[]) => Promise<void>,
  deleteByAlbum: (tx: DbOrTx, albumId: string) => Promise<void>,
};
```

- [ ] **Step 1: 写失败测试** — `album-photo-repo.test.ts`,照抄 `album-repo.test.ts` 结构(node:test + isDbReachable skip + makeUser/makeAlbum + try/finally cleanupUser):

```ts
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @yujee/web exec tsx --test src/db/repos/album-photo-repo.test.ts`
Expected: FAIL(模块不存在)

- [ ] **Step 3: 实现**
  1. `schema.ts`:新增(albumId 列类型与 FK **逐字镜像 `albumPages`** 的写法,含 onDelete 行为):

```ts
export const albumPhotoStatusEnum = pgEnum('album_photo_status', ['uploaded', 'missing']);
export const albumPhotos = pgTable('album_photos', {
  albumId: /* 镜像 albumPages.albumId 的类型与 references 配置 */,
  photoId: text('photo_id').notNull(),
  status: albumPhotoStatusEnum('status').notNull().default('uploaded'),
  width: integer('width'),
  height: integer('height'),
  bytes: integer('bytes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.albumId, t.photoId] }),
}));
export type AlbumPhoto = typeof albumPhotos.$inferSelect;
```

  2. `pnpm --filter @yujee/web db:generate` 生成迁移(新表 + 新枚举,**无既有枚举加值,单批部署安全**;生成名是随机词,不用改)。
  3. `album-photo-repo.ts` 按 Interfaces 实现;`upsertMany` 用 `onConflictDoUpdate`(target 复合主键),set 用 `sql`excluded.xxx``,并带 `updatedAt: new Date()`。**status 语义**:`excluded.status='missing'` 时不得覆盖已 `uploaded` 的行 —— set 里 status 用 `sql`CASE WHEN ${albumPhotos.status} = 'uploaded' THEN ${albumPhotos.status} ELSE excluded.status END``(width/height/bytes 同理保留已上传行的值)。
  4. `__test__/setup.ts` 的 `cleanupUser`:紧挨 albumPages 删除行,补 `album_photos` 同款子查询删除。
  5. `album-service.ts` `delete`(:1285)事务内补一行 `await albumPhotoRepo.deleteByAlbum(tx, albumId)`(若 FK 已 cascade 也保留显式删,与 albumPages 处理方式保持一致——以现场读到的 delete 实现为准对齐)。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @yujee/web db:migrate && pnpm --filter @yujee/web exec tsx --test src/db/repos/album-photo-repo.test.ts src/db/repos/album-repo.test.ts && pnpm --filter @yujee/web typecheck`
Expected: 全 PASS(含既有 album-repo 测试不回归)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/db/schema.ts apps/web/src/db/migrations apps/web/src/db/repos/album-photo-repo.ts apps/web/src/db/repos/album-photo-repo.test.ts apps/web/src/db/repos/__test__/setup.ts apps/web/src/services/album/album-service.ts
git commit -m "feat(web): album_photos 表与 repo(照片原图登记)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: photo-original-util 纯函数层

**Files:**
- Create: `apps/web/src/services/album/photo-original-util.ts`
- Test: `apps/web/src/services/album/photo-original-util.test.ts`

**Interfaces:**
- Consumes: `isValidPhotoId`(photo-snapshot-util)、zod
- Produces(Task 4/6 消费,签名逐字一致):

```ts
export const PHOTO_ORIGINAL_CONTENT_TYPE = 'image/jpeg';
export const PHOTO_ORIGINAL_MAX_COUNT = 300;
export function photoOriginalKey(albumId: string, photoId: string): string; // `photo-originals/${albumId}/${photoId}.jpg`,photoId 非法即 throw VALIDATION_FAILED
export const PhotoOriginalEntrySchema: z.ZodType<{ photoId: string; width: number; height: number; bytes: number }>; // .strict(),int 正数,bytes ≤ 30MB
export type PhotoOriginalEntry = z.infer<typeof PhotoOriginalEntrySchema>;
export const PhotoOriginalEntriesBodySchema; // { entries: Entry[] } .strict(),1..300,photoId 查重(superRefine 报到 [index,'photoId'])
export const PhotoOriginalConfirmBodySchema; // { entries?: Entry[], missing?: string[] } .strict(),两者至少一个非空,合计 ≤300,photoId 全量查重
export const PhotoOriginalUrlsBodySchema;    // { photoIds: string[] } .strict(),1..300,photoId 合法性校验
```

- [ ] **Step 1: 写失败测试** — 纯函数测试,无 DB/R2/env 依赖:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  photoOriginalKey, PhotoOriginalEntriesBodySchema,
  PhotoOriginalConfirmBodySchema, PhotoOriginalUrlsBodySchema,
} from './photo-original-util';

test('photoOriginalKey shape and validation', () => {
  assert.equal(photoOriginalKey('a1', 'p1'), 'photo-originals/a1/p1.jpg');
  assert.throws(() => photoOriginalKey('a1', '../etc'), (e: { code?: string }) => e.code === 'VALIDATION_FAILED');
});

test('entries body rejects dup photoId and >300', () => {
  const entry = (id: string) => ({ photoId: id, width: 10, height: 10, bytes: 100 });
  assert.equal(PhotoOriginalEntriesBodySchema.safeParse({ entries: [entry('p1'), entry('p1')] }).success, false);
  assert.equal(PhotoOriginalEntriesBodySchema.safeParse({ entries: Array.from({ length: 301 }, (_, i) => entry(`p${i}`)) }).success, false);
  assert.equal(PhotoOriginalEntriesBodySchema.safeParse({ entries: [entry('p1')] }).success, true);
});

test('confirm body needs at least one of entries/missing', () => {
  assert.equal(PhotoOriginalConfirmBodySchema.safeParse({}).success, false);
  assert.equal(PhotoOriginalConfirmBodySchema.safeParse({ missing: ['p1'] }).success, true);
});

test('urls body validates photoIds', () => {
  assert.equal(PhotoOriginalUrlsBodySchema.safeParse({ photoIds: [] }).success, false);
  assert.equal(PhotoOriginalUrlsBodySchema.safeParse({ photoIds: ['ok-id'] }).success, true);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @yujee/web exec tsx --test src/services/album/photo-original-util.test.ts`
Expected: FAIL(模块不存在)

- [ ] **Step 3: 实现** — 形状全面照抄 `photo-snapshot-util.ts`(常量、`.strict()`、superRefine 查重、key 函数抛 `ERRORS.VALIDATION_FAILED`)。photoId 校验统一 `z.string().refine(isValidPhotoId, 'invalid photoId')`。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @yujee/web exec tsx --test src/services/album/photo-original-util.test.ts && pnpm --filter @yujee/web typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/services/album/photo-original-util.ts apps/web/src/services/album/photo-original-util.test.ts
git commit -m "feat(web): photo-original 纯函数层(key/schema)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: photo-original-service + 三个路由

**Files:**
- Create: `apps/web/src/services/album/photo-original-service.ts`
- Create: `apps/web/src/app/api/v1/albums/[uuid]/photo-originals/upload-url/route.ts`、`.../photo-originals/route.ts`、`.../photo-originals/urls/route.ts`
- Test: `apps/web/src/services/album/photo-original-flow.test.ts`

**Interfaces:**
- Consumes: Task 1 `r2.signGetUrl`、Task 2 `albumPhotoRepo`、Task 3 全部、`albumRepo.findById/findByIdForUpdate`、`ERRORS`、`requireAuth`/`parseBody`/`ok`/`fromException`
- Produces(Task 6 按 HTTP 契约消费):

```ts
export const photoOriginalService = {
  signUpload(userId: string, albumId: string, entries: PhotoOriginalEntry[]): Promise<{ photoId: string; putUrl: string; r2Key: string }[]>,
  confirm(userId: string, albumId: string, input: { entries?: PhotoOriginalEntry[]; missing?: string[] }): Promise<{ uploaded: number; missing: number }>, // 返回该册最新计数
  getUrls(userId: string, albumId: string, photoIds: string[]): Promise<Record<string, string>>, // 仅 status='uploaded' 的出 presigned GET,TTL 300s
};
```

HTTP 契约(信封 `{ok,data}`):
- `POST /api/v1/albums/{uuid}/photo-originals/upload-url` body `{ entries }` → `SignedUpload[]`
- `POST /api/v1/albums/{uuid}/photo-originals` body `{ entries?, missing? }` → `{ uploaded, missing }`
- `POST /api/v1/albums/{uuid}/photo-originals/urls` body `{ photoIds }` → `Record<photoId, url>`

- [ ] **Step 1: 写失败测试** — `photo-original-flow.test.ts`,**顶部先预置 env 再顶层 `await import()`**(照抄 photo-snapshot-flow.test.ts:1-18 的样板),覆盖:

```ts
// 1) signUpload:owner 拿到每张的 putUrl(含 X-Amz-Signature)与正确 r2Key;非 owner 抛 ALBUM_NOT_OWNED;>300 抛 VALIDATION_FAILED
// 2) confirm:entries 落 uploaded 行;missing 落 missing 行;重复 confirm 幂等;
//    已 uploaded 的 photoId 出现在 missing 里不被降级(行锁事务内先读再过滤)
// 3) getUrls:只对 uploaded 的 photoId 出 URL(含 X-Amz-Signature 与 photo-originals/ 前缀);missing/未登记的不出现在结果里
// 4) 非 owner 调 confirm/getUrls 抛 ALBUM_NOT_OWNED
test('photo-original flow: sign -> confirm -> getUrls', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  // makeUser/makeAlbum → signUpload 断言 key = photo-originals/{albumId}/{photoId}.jpg
  // confirm({entries:[p1], missing:['p2']}) → { uploaded: 1, missing: 1 }
  // confirm({missing:['p1']}) → p1 仍 uploaded(不降级)
  // getUrls([p1,p2,'p3']) → 只有 p1
});
```

(按此注释骨架写全 4 个 test,断言用 `assert.rejects(fn, (e) => e.code === '...')` 惯例。)

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @yujee/web exec tsx --test src/services/album/photo-original-flow.test.ts`
Expected: FAIL(模块不存在)

- [ ] **Step 3: 实现**
  - service 独立文件(镜像 `share-service.ts` 的独立单例风格,不塞进 1700 行的 album-service):
    - `signUpload`:`albumRepo.findById` + owner 比对(抛 `ALBUM_NOT_FOUND`/`ALBUM_NOT_OWNED`)→ service 内二次 `PhotoOriginalEntriesBodySchema` 校验(不信任路由)→ 逐张 `photoOriginalKey` + `r2.signPutUrl(key, PHOTO_ORIGINAL_CONTENT_TYPE, 300)`。无 DB 写。
    - `confirm`:`db.transaction` + `albumRepo.findByIdForUpdate` 行锁 → owner 比对 → 校验 → 事务内 `albumPhotoRepo.findByAlbum` 读现状 → missing 列表里过滤掉已 uploaded 的 → `albumPhotoRepo.upsertMany` → 返回全册 `{uploaded, missing}` 计数。
    - `getUrls`:owner 校验 → `findByAlbum` → 过滤 `status==='uploaded'` 且在请求列表内 → 逐张 `r2.signGetUrl(photoOriginalKey(albumId, photoId), 300)`。
  - 三个路由全部套标准模板:`requireAuth(req)` → `await ctx.params` → `parseBody(schema, req)` → service → `ok(data)`;catch `fromException(e)`。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @yujee/web exec tsx --test src/services/album/photo-original-flow.test.ts && pnpm --filter @yujee/web typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/services/album/photo-original-service.ts apps/web/src/app/api/v1/albums/[uuid]/photo-originals apps/web/src/services/album/photo-original-flow.test.ts
git commit -m "feat(web): photo-originals presign/confirm/urls 服务与路由

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: getDetail 投影照片原图计数

**Files:**
- Modify: `apps/web/src/services/album/album-service.ts`(`getDetail` :439-506 的 album 投影)、`apps/web/src/lib/hooks/use-album-poll.ts`(AlbumDetail 类型 + `albumLiveSignature`)
- Test: `apps/web/src/services/album/photo-original-flow.test.ts`(追加一个 test)

**Interfaces:**
- Consumes: Task 2 `albumPhotoRepo.findByAlbum`
- Produces: `getDetail` 返回的 `album` 新增 `photoOriginals: { uploaded: number; missing: number }`(无行时 `{uploaded:0,missing:0}`);前端 `AlbumDetail['album']` 同步该字段,并把两个计数并入 `albumLiveSignature`(上传落地后轮询能触发 UI 刷新)。

- [ ] **Step 1: 写失败测试** — flow 测试追加:

```ts
test('getDetail projects photoOriginals counts', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  // makeUser/makeAlbum → confirm({entries:[p1], missing:['p2']})
  // albumService.getDetail(user.id, album.id) → detail.album.photoOriginals 深等于 { uploaded: 1, missing: 1 }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @yujee/web exec tsx --test src/services/album/photo-original-flow.test.ts`
Expected: 新增用例 FAIL(字段 undefined)

- [ ] **Step 3: 实现** — `getDetail` 里并行读 `albumPhotoRepo.findByAlbum(albumId)` 归并计数进投影;`use-album-poll.ts` 的类型与 signature 同步。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @yujee/web exec tsx --test src/services/album/photo-original-flow.test.ts && pnpm --filter @yujee/web typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/services/album/album-service.ts apps/web/src/lib/hooks/use-album-poll.ts apps/web/src/services/album/photo-original-flow.test.ts
git commit -m "feat(web): getDetail 投影 photoOriginals 计数

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: 浏览器客户端封装 photo-original-client

**Files:**
- Create: `apps/web/src/lib/album/photo-original-client.ts`

**Interfaces:**
- Consumes: Task 4 的 HTTP 契约;`photo-snapshot-client.ts` 的 `postJson` 信封解法(同文件内自带一份,勿跨文件 import 私有函数)
- Produces(Task 8 消费):

```ts
export type PhotoOriginalUploadEntry = { photoId: string; width: number; height: number; bytes: number };
export type SignedPhotoOriginalUpload = { photoId: string; putUrl: string; r2Key: string };
export function signPhotoOriginalUpload(albumId: string, entries: PhotoOriginalUploadEntry[]): Promise<SignedPhotoOriginalUpload[]>;
export function confirmPhotoOriginals(albumId: string, input: { entries?: PhotoOriginalUploadEntry[]; missing?: string[] }): Promise<{ uploaded: number; missing: number }>;
export function fetchPhotoOriginalUrls(albumId: string, photoIds: string[]): Promise<Record<string, string>>;
export function putPhotoOriginalBlob(putUrl: string, blob: Blob): Promise<void>; // header content-type: image/jpeg,必须与签名一致,非 2xx 抛错
```

- [ ] **Step 1: 实现**(纯 fetch 封装,与 `photo-snapshot-client.ts` 同构;该文件无单测先例,本任务以 typecheck + Task 8 的依赖注入测试覆盖)

- [ ] **Step 2: 验证**

Run: `pnpm --filter @yujee/web typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/album/photo-original-client.ts
git commit -m "feat(web): photo-original 浏览器客户端封装

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: photoStore 远端回退 + 规范原图导出

**Files:**
- Modify: `apps/web/src/lib/photo/store.ts`
- Test: `apps/web/src/lib/photo/store.test.ts`(追加用例,沿用该文件既有的 IndexedDB 测试基建)

**Interfaces:**
- Consumes: store 内部 `downscaleToJpeg`、`toMemoryBackedBlob`、`prepareImageBlobForBrowserDecode`、`TIER_MAX_EDGE`/`TIER_QUALITY`
- Produces(Task 8 消费):

```ts
export type RemoteOriginalFetcher = (photoId: string) => Promise<Blob | undefined>;
photoStore.setRemoteOriginalFetcher(fetcher: RemoteOriginalFetcher | null): void;
// getBlob(photoId):本地 miss → fetcher 存在且 photoId 合法(排除 boardbg- 前缀、不匹配 /^[A-Za-z0-9-]{1,64}$/ 的 key)
//   → await fetcher → toMemoryBackedBlob → 写回 originals store → 返回;fetcher 失败/undefined → 返回 undefined(既有兜底不变)
//   同一 photoId 的并发回退请求要合并(in-flight Map),避免重复下载
photoStore.getCanonicalUploadBlob(photoId: string): Promise<{ blob: Blob; width: number; height: number } | undefined>;
// 只读本地(绝不触发 remote fetcher),HEIC 先转,downscaleToJpeg(TIER_MAX_EDGE.backup=3400, TIER_QUALITY.backup=0.82),无滤镜
```

- [ ] **Step 1: 写失败测试** — 追加到 `store.test.ts`:

```ts
// 1) 本地 miss 且设置了 fetcher:getBlob 返回 fetcher 的 blob,且第二次 getBlob 不再调 fetcher(已回填缓存)
// 2) 并发两次 getBlob(同 id)只触发一次 fetcher 调用
// 3) 'boardbg-xxx' key 永不触发 fetcher
// 4) fetcher 返回 undefined 时 getBlob 返回 undefined
// 5) getCanonicalUploadBlob:本地有原图 → 返回 blob 与像素尺寸;本地无 → undefined 且不调 fetcher
```

(按注释骨架写全,fetcher 用计数 mock。)

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @yujee/web exec tsx --test src/lib/photo/store.test.ts`
Expected: 新增用例 FAIL

- [ ] **Step 3: 实现** — 注意:回退只挂在 `getBlob` 这一个咽喉点(`getObjectUrl`/`getTierBlob`/`getPdfDataUrls` 内部都会经过它,自动痊愈);模块级 `remoteFetcher` 变量 + `inflight: Map<string, Promise<Blob | undefined>>`。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @yujee/web exec tsx --test src/lib/photo/store.test.ts && pnpm --filter @yujee/web typecheck`
Expected: 新旧用例全 PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/photo/store.ts apps/web/src/lib/photo/store.test.ts
git commit -m "feat(web): photoStore 远端原图回退与规范原图导出

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: 对账补传模块 + 编辑器接线

**Files:**
- Create: `apps/web/src/lib/album/photo-original-sync.ts`、`apps/web/src/lib/hooks/use-photo-original-sync.ts`
- Modify: `apps/web/src/components/album/EditorPort.tsx`、`apps/web/src/components/album/editor-v2/mobile/MobileEditorRoot.tsx`(**脏文件,最小插入**)
- Test: `apps/web/src/lib/album/photo-original-sync.test.ts`

**Interfaces:**
- Consumes: Task 6 client 全部、Task 7 `photoStore.getCanonicalUploadBlob` / `setRemoteOriginalFetcher`、Task 5 的 `album.photoOriginals`
- Produces:

```ts
// photo-original-sync.ts(依赖全注入,纯逻辑可单测)
export type PhotoOriginalSyncDeps = {
  getCanonicalUploadBlob: (photoId: string) => Promise<{ blob: Blob; width: number; height: number } | undefined>;
  sign: (albumId: string, entries: PhotoOriginalUploadEntry[]) => Promise<SignedPhotoOriginalUpload[]>;
  put: (putUrl: string, blob: Blob) => Promise<void>;
  confirm: (albumId: string, input: { entries?: PhotoOriginalUploadEntry[]; missing?: string[] }) => Promise<{ uploaded: number; missing: number }>;
};
export function planPhotoOriginalSync(bookPhotoIds: string[], serverUploaded: ReadonlySet<string>): string[]; // 差集,保序去重(missing 的也重试——本机可能这次有)
export async function runPhotoOriginalSync(input: {
  albumId: string; photoIds: string[]; serverUploaded: ReadonlySet<string>;
  deps: PhotoOriginalSyncDeps; onProgress?: (done: number, total: number) => void;
}): Promise<{ uploaded: number; missingLocal: number }>;
// 逐张 getCanonicalUploadBlob(并发 3):有 → 攒 entry;无 → 攒 missing
// 每 50 张一批:sign → put(逐张失败只丢该张,不中断)→ confirm({entries});最后一次性 confirm({missing})
// 任何批次失败不抛出,计入结果;photoId 幂等,断点续传天然成立(下次对账差集自动缩小)
```

`use-photo-original-sync.ts`:`usePhotoOriginalSync({ albumId, photoIds, photoOriginals, enabled })` —— `enabled && photoIds.length > 0` 且(uploaded+missing 覆盖不全 photoIds)时,每 (albumId + photoIds 签名) 只跑一次 `runPhotoOriginalSync`(真实 deps 绑定 client + photoStore);同一 hook 里 mount 时 `photoStore.setRemoteOriginalFetcher`(用 `fetchPhotoOriginalUrls(albumId,[id])` + `fetch(url)`,404/失败回 undefined),unmount 时设回 null。

- [ ] **Step 1: 写失败测试** — `photo-original-sync.test.ts`(纯注入,无 DOM/DB):

```ts
// 1) planPhotoOriginalSync:差集与去重(uploaded 的排除,missing 不排除)
// 2) runPhotoOriginalSync:3 张本地有、1 张本地无 → sign/put/confirm 调用次数与 payload 正确,
//    结果 { uploaded: 3, missingLocal: 1 };onProgress 单调递增到 total
// 3) put 有一张抛错 → 该张不进 confirm entries,其余照常,函数不抛
// 4) photoIds 全部已 uploaded → 零网络调用
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @yujee/web exec tsx --test src/lib/album/photo-original-sync.test.ts`
Expected: FAIL(模块不存在)

- [ ] **Step 3: 实现模块与 hook**(hook 无单测,靠 typecheck;逻辑全部压在可测的 sync 模块里)

- [ ] **Step 4: 编辑器接线** — 两处、各一行为限:
  - `EditorPort.tsx`:在既有 `refreshBackupStatus()` 挂载点旁(约 :5391 一带的挂载 effect)调用 `usePhotoOriginalSync({...})`,photoIds 用既有 `bookPhotoIds()` 来源。
  - `MobileEditorRoot.tsx`:**先 `git diff` 看用户在途改动**,在 `usePhotoBackup`(约 :572-576)旁边同款插入。只加行,不动既有行;若该区域正被用户改动,把插入点移到相邻稳定处并在 commit message 里注明。

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm --filter @yujee/web exec tsx --test src/lib/album/photo-original-sync.test.ts && pnpm --filter @yujee/web typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/album/photo-original-sync.ts apps/web/src/lib/album/photo-original-sync.test.ts apps/web/src/lib/hooks/use-photo-original-sync.ts apps/web/src/components/album/EditorPort.tsx apps/web/src/components/album/editor-v2/mobile/MobileEditorRoot.tsx
git commit -m "feat(web): 照片原图对账补传与编辑器接线

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: 文档改写 + 全量验证

**Files:**
- Modify: `README.md`(设计边界的照片条目、doc-scope checked-at)、`CLAUDE.md`(照片边界、checked-at)、`apps/web/README.md`(Browser Data Boundary、Database Boundary 表清单、checked-at)

**Interfaces:** 无代码;文案要点:
- 「原图由 Browser 持有」改为「照片规范原图(3400px JPEG)以 R2 为真相源,浏览器 IndexedDB 为缓存;原始相机文件仍不出浏览器」。
- Database Boundary 表清单补 `album_photos`。
- 三份文档的 doc-scope `checked-at` 推进到本分支最新提交(`git log -1 --format=%h`)。
- **注意 README.md / CLAUDE.md 当前是脏文件**(用户在途),同 Task 8 的警戒:最小 diff、不回滚用户改动、只 add 属于本任务的 hunk 确认后再提交(可用 `git add -p` 或先与用户改动合流)。

- [ ] **Step 1: 改写三份文档**(如上要点)

- [ ] **Step 2: 全量验证**

Run(逐条):
```bash
pnpm --filter @yujee/web test
pnpm typecheck        # 此时 docs:check 应绿(checked-at 已推进)
```
Expected: 全 PASS。红了先修再来,不许带红提交。

- [ ] **Step 3: Commit**

```bash
git add README.md CLAUDE.md apps/web/README.md
git commit -m "docs: 照片持有模型迁 R2 后的边界改写

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## 并行分组(subagent 分摊用)

- **第一波(互不依赖,可并行)**:Task 1、Task 2、Task 3、Task 7
- **第二波**:Task 4(要 1+2+3)、Task 6(只要 Task 3 的类型形状,可与 Task 4 并行)
- **第三波**:Task 5(要 2+4)、Task 8(要 5+6+7)
- **收尾串行**:Task 9
- 并行任务各自 commit 自己的文件;都改 `photo-original-flow.test.ts` 的 Task 4/5 有先后,不并行。

## Self-Review 结论(计划作者自查)

- **规格覆盖**:design Phase 0 章逐条 → 存储 key/格式(T3/T7)、album_photos(T2)、presign 三段式(T4/T6)、IndexedDB 降级缓存(T7)、存量对账补传+missing(T8)、getDetail 透出迁移状态(T5,spec 的 `photos_migrated` 以派生计数实现,避免陈旧标志)、文档与隐私边界(T9)。分享快照链路零改动(全计划无一处碰 photo-snapshot-*)。隐私对外文案、存储回收、Phase 1 门槛判定属 spec 开放问题/Phase 1,不在本计划。
- **类型一致**:`PhotoOriginalEntry`(T3)= client 侧 `PhotoOriginalUploadEntry`(T6)字段一致;`AlbumPhotoUpsert`(T2)只在服务端内部;`getCanonicalUploadBlob` 返回形状在 T7/T8 逐字一致;`RemoteOriginalFetcher` 只在 T7 定义、T8 经 photoStore 使用。
- **已知妥协(实施时留意)**:① presigned GET 按需批量签,未做 URL 缓存——量大时每次对账/回退多几次签名调用,可接受;② hook 与路由无独立单测,逻辑压进纯模块;③ `missing` 状态可被后续成功上传翻转,但不会反向降级(T2 的 CASE 保护 + T4 行锁内过滤双保险);④ MobileEditorRoot/README/CLAUDE.md 是用户在途脏文件,两个任务里都写了警戒规程。
