# 匿名免登录排版(游客模式)实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 登录墙从「落地页点发送」后移到「Agent 对话打字 / 保存 / 分享」三个触发点;匿名用户全程可用(含占位文案成书与本地导出),登录后相册自动过户并补跑真 AI 文案。

**Architecture:** better-auth anonymous 插件造影子账号(`users.is_anonymous`),现有 `requireAuth` 放行匿名,新增 `requireRealUser` 挡三个登录触发点。匿名确认封面走「占位成稿」:复用 `mergeComposeIntoDraft` 传空 compose payload(内页 sample 文案在 select-layout 时已由 engine 填好),同步落库、零 AI。登录时 `onLinkAccount` 过户相册,前端检测 `albums.copy_source='placeholder'` 自动重发 POST /design 跑真 compose(此时才 precheck+hold 积分)。

**Tech Stack:** Next.js 15 App Router / better-auth 1.4.17 (anonymous plugin) / drizzle + postgres.js / node:test (tsx --test)

## Global Constraints

- 匿名照片上限 **20** 张(= FREE_PLAN_CREDITS);登录用户维持 `MAX_PHOTOS_PER_GENERATION = 100`
- 每匿名账号 **1 本**相册;匿名注册每 IP 每小时 **5** 次
- 匿名阶段**零 R2 写入**、**零 Gemini 调用**、**零积分变动**(不送 20 积分、创建不 hold)
- 真 compose 计费:`copy_source='placeholder'` 的相册在 applyDesign 时 precheck+hold,compose 完成回调 settle,失败 release
- **绝不跑 `db:migrate`**(dev 账本漂移):新迁移写幂等 SQL,`psql $DATABASE_URL -f` 手工应用,手补 `meta/_journal.json`
- 插件顺序必须 `[anonymous(...), nextCookies()]`(nextCookies 收尾)
- 服务对象一律 `export const xxx = {...}` 字面量;API 路由一律 `try { requireX → parseBody → service → ok } catch { fromException }`
- 错误码表保持列对齐、语义分组;新增:`ANON_UPGRADE_REQUIRED`(403)、`ANON_ALBUM_LIMIT`(403)、`ANON_PHOTO_LIMIT`(403)
- 占位成稿**不写** `#artFont`/`#accentColor` 之外的新 carrier 语义;改 texts 必须 `bakePagesHtml(pages.map(p => ({...p, html: undefined})))`
- 测试:node:test;真库集成用 `isDbReachable()` + `t.skip` + `try/finally cleanupUser`;纯逻辑抽 `*-util.ts`

---

### Task 1: 迁移 0025 + drizzle schema(users.is_anonymous / albums.copy_source)

**Files:**
- Create: `apps/web/src/db/migrations/0025_anon_guest_flow.sql`
- Modify: `apps/web/src/db/migrations/meta/_journal.json`(追加 entry)
- Modify: `apps/web/src/db/schema.ts:98` 旁(users)、`schema.ts:283` 前(albums)

**Interfaces:**
- Produces: `users.isAnonymous: boolean NOT NULL DEFAULT false`;`albums.copySource: text | null`('placeholder' | 'ai' | null)。`User`/`Album` 类型自动带上。

- [ ] **Step 1:** 写迁移 SQL(幂等):

```sql
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_anonymous" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "albums" ADD COLUMN IF NOT EXISTS "copy_source" text;
```

- [ ] **Step 2:** `_journal.json` 追加(照 0024 手写风格,`when` 取比上一条大的圆整时间戳):

```json
{"idx": 25, "version": "7", "when": 1785900000000, "tag": "0025_anon_guest_flow", "breakpoints": true}
```

- [ ] **Step 3:** schema.ts:users 表 `isAdmin` 下加 `isAnonymous: boolean('is_anonymous').notNull().default(false),`;albums 表 `creditHoldId` 旁加注释 + `copySource: text('copy_source'),`(注释:占位成稿标记,'placeholder'=匿名占位文案,'ai'=真 compose 已写,null=旧相册/未成稿)

- [ ] **Step 4:** `psql "$DATABASE_URL" -f apps/web/src/db/migrations/0025_anon_guest_flow.sql` 手工应用本地库(DATABASE_URL 取 env 默认 `postgresql://yujee:yujee@localhost:5432/yujee_dev`)

- [ ] **Step 5:** `pnpm --filter @yujee/web typecheck` 过;commit `feat(db): users.is_anonymous + albums.copy_source(迁移 0025,psql 手工应用)`

---

### Task 2: better-auth 匿名插件接入 + 过户服务 + 积分分流 + 注册限流

**Files:**
- Modify: `apps/web/src/lib/auth/better-auth.ts`(plugins、databaseHooks、hooks)
- Modify: `apps/web/src/lib/auth/client.ts`(anonymousClient)
- Create: `apps/web/src/services/user/anon-transfer-service.ts` + `.test.ts`
- Create: `apps/web/src/lib/api/client-ip.ts` + `.test.ts`
- Modify: `apps/web/src/lib/auth/better-auth.test.ts`(plugins length、additionalFields deepEqual)

**Interfaces:**
- Produces: `anonTransferService.transfer(anonUserId: string, realUserId: string): Promise<{albums: number}>`(事务内 UPDATE albums/agent_jobs/album_messages 的 userId);`clientIpFrom(headers: Headers): string | null`(x-forwarded-for 首段 → x-real-ip → null)
- 服务端插件:`anonymous({ onLinkAccount, disableDeleteAnonymousUser: false })`;client:`authClient.signIn.anonymous()`

- [ ] **Step 1:** `client-ip.ts`(纯函数,照 matchesCronSecret 模式):

```ts
export function clientIpFrom(headers: Headers): string | null {
  const fwd = headers.get('x-forwarded-for');
  if (fwd) {
    const first = fwd.split(',')[0]?.trim();
    if (first) return first;
  }
  return headers.get('x-real-ip')?.trim() || null;
}
```

测试:new Request 构造 headers 真值表(有 xff 多段取首、只有 x-real-ip、都没有 → null)。

- [ ] **Step 2:** `anon-transfer-service.ts`:

```ts
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { albums, agentJobs, albumMessages } from '@/db/schema';
import { logger } from '@/lib/log/logger';

// 匿名账号转正:把匿名期产生的行整体过户给真实账号。插件 onLinkAccount 在删除匿名
// 用户之前调用(index.mjs:140-152),这里不搬的行会被 11 处 onDelete:'cascade' 连锅端。
// credit_* 不搬(匿名零积分变动);draft_pages.updatedBy 无 FK,留旧 id 无害。
export const anonTransferService = {
  async transfer(anonUserId: string, realUserId: string): Promise<{ albums: number }> {
    return db.transaction(async (tx) => {
      const moved = await tx.update(albums).set({ userId: realUserId, updatedAt: new Date() })
        .where(eq(albums.userId, anonUserId)).returning({ id: albums.id });
      await tx.update(agentJobs).set({ userId: realUserId }).where(eq(agentJobs.userId, anonUserId));
      await tx.update(albumMessages).set({ userId: realUserId }).where(eq(albumMessages.userId, anonUserId));
      logger.info({ anonUserId, realUserId, albums: moved.length }, 'anon account linked; albums transferred');
      return { albums: moved.length };
    });
  },
};
```

(实施时核对 agentJobs/albumMessages 列名与 updatedAt 是否存在,按 schema 实际形状调整。)

- [ ] **Step 3:** better-auth.ts 改 `createAuthOptions`:
  - import `anonymous` from `'better-auth/plugins/anonymous'`、`APIError` from `'better-auth/api'`、`anonTransferService`、`clientIpFrom`、db/schema(sessions/users 计数用)
  - `plugins: [anonymous({ onLinkAccount: async ({ anonymousUser, newUser }) => { await anonTransferService.transfer(anonymousUser.user.id, newUser.user.id); } }), nextCookies()]`
  - `databaseHooks: { user: { create: { before: async (user) => { if ((user as { isAnonymous?: boolean }).isAnonymous) { return { data: { ...user, creditBalance: 0 } }; } } } } }`(匿名不送 20 积分;真实注册仍走 additionalFields defaultValue)
  - `hooks: { before: [...] }`:matcher `ctx.path === '/sign-in/anonymous'` → 用 `clientIpFrom(ctx.headers)` 查「近 1 小时该 IP 的匿名 sessions 数」(sessions join users where isAnonymous),`>= 5` 抛 `new APIError('TOO_MANY_REQUESTS', { message: 'Too many guest sign-ups from this address' })`;IP 为 null 时放行
  - 邮箱注册转正兜底:`hooks: { after: [...] }` matcher `ctx.path === '/verify-email'`,镜像插件 after-hook 逻辑(set-cookie 里有 session token + 请求 cookie 里的旧 session 是匿名 → transfer + `internalAdapter.deleteUser(anonId)`)。实施时参照 `node_modules/.pnpm/better-auth@1.4.17_*/node_modules/better-auth/dist/plugins/anonymous/index.mjs:116-154` 逐行抄判定,注释写明"插件 matcher 不含 /verify-email 而本仓强制邮箱验证"
- [ ] **Step 4:** client.ts:`import { anonymousClient } from 'better-auth/client/plugins'`,`createAuthClient({ baseURL: ..., plugins: [anonymousClient()] })`
- [ ] **Step 5:** 修 `better-auth.test.ts`:plugins length 1→2;additionalFields deepEqual 若被 databaseHooks 改动影响则同步;新增断言:anonymous 插件在 nextCookies 之前
- [ ] **Step 6:** anon-transfer-service.test.ts(真库集成):makeUser 两个(一个手工 `upsertById` 带 `isAnonymous: true`)+ makeAlbum 归匿名者 → transfer → 断言 album.userId 换人、消息/job 同步;finally cleanupUser 两个
- [ ] **Step 7:** `pnpm --filter @yujee/web test` 相关文件过;commit

---

### Task 3: requireRealUser + getAuthUser + 错误码

**Files:**
- Modify: `apps/web/src/lib/auth/require-auth.ts`
- Modify: `apps/web/src/lib/api/error-codes.ts`
- Create: `apps/web/src/lib/auth/require-auth.test.ts`(若已存在则扩)

**Interfaces:**
- Produces: `getAuthUser(req): Promise<AuthUserWithFlags>`(`{id, email, isAnonymous}`,isAnonymous 回表读,防 5min cookie 陈旧);`requireRealUser(req): Promise<AuthUser>`(匿名抛 `ANON_UPGRADE_REQUIRED` 403);`requireAuth` 原样

- [ ] **Step 1:** error-codes.ts 在 FORBIDDEN 组附近加(保持列对齐):

```ts
  // 匿名(游客)账号触碰真实账号专属能力:前端统一拦截此码弹登录。
  ANON_UPGRADE_REQUIRED: () => new AppError('ANON_UPGRADE_REQUIRED', 'Sign in to continue',      403),
  ANON_ALBUM_LIMIT:      () => new AppError('ANON_ALBUM_LIMIT',      'Guest limit: one album',   403),
  ANON_PHOTO_LIMIT:      () => new AppError('ANON_PHOTO_LIMIT',      'Guest limit: 20 photos',   403),
```

- [ ] **Step 2:** require-auth.ts 加(照 requireAdmin 回表模式):

```ts
export type AuthUserWithFlags = AuthUser & { isAnonymous: boolean };

export async function getAuthUser(req: Request): Promise<AuthUserWithFlags> {
  const base = await requireAuth(req);
  const { userRepo } = await import('@/db/repos/user-repo');
  const row = await userRepo.findById(base.id);
  if (!row) throw ERRORS.UNAUTHORIZED();
  return { id: row.id, email: row.email, isAnonymous: row.isAnonymous };
}

export async function requireRealUser(req: Request): Promise<AuthUser> {
  const user = await getAuthUser(req);
  if (user.isAnonymous) throw ERRORS.ANON_UPGRADE_REQUIRED();
  return { id: user.id, email: user.email };
}
```

- [ ] **Step 3:** 测试(真库):匿名行 → requireRealUser 抛 403 码;真实行 → 通过;getAuthUser isAnonymous 正确。session mock 层面若难以构造,退而 mock `getAuth().api.getSession`(mock.method 动态 import 后的实例;参照 share-service.test 的先 env 后动态 import 套路)
- [ ] **Step 4:** 测试过,commit

---

### Task 4: API 门禁扫刷(requireRealUser 落到真实账号专属路由)

**Files(全部只改 import 与调用行 + 顶注一句话):**
- `api/v3/albums/[uuid]/design-chat/route.ts`(登录触发点①)
- `api/v1/albums/[uuid]/share/route.ts`(②)
- `api/v1/albums/[uuid]/photo-snapshot-upload-url/route.ts`、`photo-snapshot/route.ts`(③ 保存)
- `api/v1/albums/[uuid]/photo-originals/*`(3 条)、`pdf-upload-url/route.ts`、`pdf/route.ts`、`cover-thumbnail*`(2 条)——R2 写入面
- `api/v1/feedback/route.ts`、`api/v1/credit/balance`、`credit/history`、`api/v1/billing/checkout`、`api/v1/invite/redeem`、`api/v1/user/billing`
- 保持 requireAuth(匿名可):albums POST/GET、[uuid] GET、chapter-context、story-progress、select-layout、design GET/POST、add-photos、compose-append、draft、retry、messages、fonts/subset、pages/reorder、pages/[idx]、user/me、albums list

- [ ] **Step 1:** 逐文件把 `requireAuth` 换成 `requireRealUser`(import 同步),路由顶注加一句「匿名(游客)不可用:...」
- [ ] **Step 2:** 写一个源码断言测试 `apps/web/src/lib/auth/anon-gate.test.ts`(照 my-albums-design.test.ts 的 readFileSync+regex 套路):列出上面每个 real-only 路由文件,断言含 `requireRealUser`;列出匿名可用路由,断言仍是 `requireAuth(`/`getAuthUser(` 且不含 `requireRealUser`。防回归。
- [ ] **Step 3:** 测试过,commit

---

### Task 5: 匿名建相册/加照片分支(零积分 + 上限 + 防重)

**Files:**
- Modify: `apps/web/src/app/api/v3/albums/route.ts`(requireAuth→getAuthUser,透传 isAnonymous)
- Modify: `apps/web/src/app/api/v3/albums/[uuid]/add-photos/route.ts`(同上)
- Modify: `apps/web/src/services/generation/generation-service.ts`
- Create: `apps/web/src/config/anon.ts`(常量:`ANON_MAX_PHOTOS_PER_GENERATION = 20`、`ANON_MAX_ALBUMS = 1`、`ANON_SIGNUP_PER_IP_PER_HOUR = 5`、`ANON_CLEANUP_DAYS = 7`)
- Test: `generation-service` 现有测试文件扩 / 新建 `generation-service-anon.test.ts`

**Interfaces:**
- Consumes: `getAuthUser`(Task 3)
- Produces: `generationService.submitAnalyzeV3(userId, input, opts?: { isAnonymous?: boolean })`;`submitAddPhotosV3` 同形

- [ ] **Step 1:** submitAnalyzeV3 匿名分支:
  - `if (opts?.isAnonymous)`:跳过 `precheck`;事务里先 `tx.select().from(users).where(eq(users.id, userId)).for('update')` 锁行,再 `albumRepo.findByUser(userId)` 计数 `>= ANON_MAX_ALBUMS` 抛 `ERRORS.ANON_ALBUM_LIMIT()`(锁行序列化双击并发);`input.photos.length > ANON_MAX_PHOTOS_PER_GENERATION` 抛 `ANON_PHOTO_LIMIT`(在事务外最前面判);跳过 `creditService.hold`
  - 非匿名路径一行不变
- [ ] **Step 2:** submitAddPhotosV3 匿名分支:总量判 `album.photoCount + input.photos.length > ANON_MAX_PHOTOS_PER_GENERATION` 抛 `ANON_PHOTO_LIMIT`;跳过 precheck/hold
- [ ] **Step 3:** 两个 route 换 `getAuthUser`,`generationService.submitXxx(user.id, body, { isAnonymous: user.isAnonymous })`
- [ ] **Step 4:** 集成测试(真库):匿名用户建第 2 本 → ANON_ALBUM_LIMIT;21 张 → ANON_PHOTO_LIMIT;匿名创建后 `credit_holds` 零行、balance 不变;真实用户路径回归(hold 仍建)
- [ ] **Step 5:** 测试过,commit

---

### Task 6: 占位成稿 + 真 compose 计费闭环

**Files:**
- Modify: `apps/web/src/services/album/album-service.ts`(新增 `applyPlaceholderDesign`;`applyDesign` 加 placeholder 计费)
- Modify: `apps/web/src/app/api/v3/albums/[uuid]/design/route.ts`(getAuthUser 分流)
- Modify: `apps/web/src/services/job/job-service.ts`(`handleV3ComposeCompleted` 落 `copySource:'ai'` + settle hold;compose 失败路径 release)
- Modify: `album-service.ts` `composeAppend`(匿名 → `{accepted:true, composed:false}`)
- Test: `apps/web/src/services/album/placeholder-design.test.ts`

**Interfaces:**
- Consumes: `mergeComposeIntoDraft(draftJsonLike, meta, payload)`(job-service.ts:199,纯函数)、`loadStoryDraft(album, {tx, bake:false})`、`ensureDraftPagesSeeded/bumpDraftRevision/draftPageRepo.replaceAll`、`albumRepo.findByIdForUpdate`
- Produces: `albumService.applyPlaceholderDesign(userId, albumId, input)`(input 与 applyDesign 同形去掉 refs)→ `{ accepted: true, placeholder: true }`

- [ ] **Step 1:** `applyPlaceholderDesign`:校验段复制 applyDesign(findOwned、EDITING、模板 category、pageBackground、封面/封尾照片在册)但**页源用 `loadStoryDraft`**(不吃 applyDesign 的陈旧 draftJson 读法);然后单事务:

```
albumRepo.findByIdForUpdate(tx, albumId)
merged = mergeComposeIntoDraft(draftJsonLike, meta, { pagesTexts: {}, coverTexts: {}, endingTexts: {}, fonts: {} })
ensureDraftPagesSeeded → bumpDraftRevision → draftPageRepo.replaceAll(tx, albumId, merged.pages, rev, userId)
albumRepo.update(tx, albumId, { draftJson: envelopeJson({...}), pageCount, stage: 'ready', copySource: 'placeholder' })
albumMessageRepo.create(tx, { role:'user', content: '就用这组封面'/'Use this cover set', layoutPatch:{designApplied:{...}} })
albumMessageRepo.create(tx, { role:'assistant', content: zh?'封面就位!文字现在是示例样稿——登录后我会照你讲的故事写出真文案。':'Cover set! The words are sample copy for now — sign in and I\'ll write the real story.' })
```

  meta 形状 = `ComposeJobMeta`(language/coverTemplateId/coverPhotoId/endingTemplateId/endingPhotoId/extraEndingPhotoIds/pageBackground),extraEndingPhotoIds 复用 applyDesign 的 `pickHeroPhotos` 逻辑(抽成小函数共享,不复制)。
- [ ] **Step 2:** design route POST:`getAuthUser` → `user.isAnonymous ? albumService.applyPlaceholderDesign(...) : albumService.applyDesign(...)`(refs 匿名侧忽略)。GET 不动。
- [ ] **Step 3:** `applyDesign` 计费:校验后 `if (album.copySource === 'placeholder') { const amount = creditService.cost(album.photoCount); await creditService.precheck(userId, amount); }`,job 事务里同条件 `creditService.hold(tx, userId, amount, albumId)`。注释:占位书的真文案首跑在此计费(analyze 期匿名没扣过)。
- [ ] **Step 4:** `handleV3ComposeCompleted` 全书分支:`albumRepo.update` 增加 `copySource: 'ai'`;其后 `if (album.creditHoldId) await creditService.settle(tx, job.userId, album.creditHoldId)`(settle 幂等,普通相册 hold 早已 SETTLED 无副作用)。`handleV3Failed` 确认对 compose kind 也走 releaseByAlbum(读现状,缺则补)。
- [ ] **Step 5:** `composeAppend` 开头:调用方传入 isAnonymous(route 层 getAuthUser)→ 匿名直接 `return { accepted: true, composed: false }`(新页 sample 文案已由 select-layout 填好,登录后全书真 compose 一起覆盖)。
- [ ] **Step 6:** 测试:
  - 纯函数级:`mergeComposeIntoDraft` 空 payload → 内页 texts 保留 sample、封面/封尾 texts = 模板 sample、fonts = 语言兜底、页有 html、pageIndex 连续(直接调用,不用 DB)
  - 集成(真库):applyPlaceholderDesign 后 album.stage='ready'、copySource='placeholder'、draft_pages 有封面页;applyDesign 对 placeholder 相册 precheck 不足 → 402;compose 完成回调后 copySource='ai' + hold SETTLED
- [ ] **Step 7:** 测试过,commit

---

### Task 7: 详情/身份下发(album detail copySource + user/me isAnonymous)

**Files:**
- Modify: album detail 组装处(`albumService.getAlbumDetail` 或 route 序列化处,实施时定位 `GET /api/v1/albums/[uuid]` 的响应体)加 `copySource`
- Modify: `api/v1/user/me/route.ts` 响应加 `isAnonymous`(改用 getAuthUser)
- Modify: `apps/web/src/components/app/useChromeSession.ts`(ChromeUser 加 isAnonymous)

- [ ] **Step 1-3:** 三处加字段,类型同步;`useChromeSession` 的 `setUser({...})` 带上 `isAnonymous: meJson.data.isAnonymous ?? false`
- [ ] **Step 4:** typecheck 过,commit(行为无变化,无独立测试;源码断言并入 Task 4 的 anon-gate.test)

---

### Task 8: 前端闸门(桌面 + 移动 + 落地页)

**Files:**
- Modify: `apps/web/src/components/landing/HeroComposer.tsx`
- Modify: `apps/web/src/lib/generation/client.ts`(错误类 + submitAnalyzeV3 跳过快照备份)
- Modify: `apps/web/src/lib/album/authoring-client.ts`、`photo-snapshot-client.ts`(ANON_UPGRADE_REQUIRED → UnauthorizedError)
- Modify: `apps/web/src/components/album/editor-v2/ChatPanel.tsx`(chat 匿名门 + 自动补跑真 compose)
- Modify: `apps/web/src/components/album/editor-v2/EditorPort.tsx`(save/share 匿名门、匿名跳过 pdf 上传、photo-original-sync 关闭、UserMenu 匿名态)
- Modify: `apps/web/src/components/album/editor-v2/mobile/MobileEditorRoot.tsx`、`mobile/use-export.ts`(同上移动侧)
- Modify: `apps/web/src/components/app/UserMenu.tsx`(匿名 → 登录 CTA)
- Modify: `apps/web/src/messages/en.json` / `zh.json`(登录 CTA key)
- Modify: `apps/web/src/app/[locale]/settings/page.tsx`、`credits/page.tsx`、`my-albums/page.tsx`(页面级匿名跳登录)
- Test: `apps/web/src/components/album/editor-v2/anon-ui-gate.test.ts`(源码断言)

**Interfaces:**
- Consumes: `authClient.signIn.anonymous()`(Task 2)、`ChromeUser.isAnonymous`(Task 7)、`AlbumDetail.copySource`(Task 7)

- [ ] **Step 1:** HeroComposer `submit()`:`if (!hasSession)` 分支改为 `await authClient.signIn.anonymous()` 失败才 `saveDraftAndLogin(draft)`;成功则继续 `submitDraft(draft, ..., { skipCloudBackup: true })`。`resumeGeneration` useEffect 同改。catch 里新增 `AnonLimitError` → `saveDraftAndLogin(draft)`(草稿保住,登录回来 resume 自动重交,解锁 100 张)。
- [ ] **Step 2:** generation/client.ts:新增 `export class AnonLimitError extends Error { readonly code = 'ANON_LIMIT'; }`;`postJobs` 里 `json.error?.code === 'ANON_PHOTO_LIMIT' || json.error?.code === 'ANON_ALBUM_LIMIT'` → throw AnonLimitError;`submitAnalyzeV3(input, opts?: { skipCloudBackup?: boolean })` 跳过 `backupGenerationPreviews`。
- [ ] **Step 3:** authoring-client.ts 两个 helper + photo-snapshot-client.ts postJson:`json.error?.code === 'ANON_UPGRADE_REQUIRED'` → `throw new UnauthorizedError()`(snapshot-client 原来连 401 都不认,一起补上 401/UNAUTHORIZED)。UnauthorizedError 的现有消费端(authErr → 跳 login?from=/album/{id})自动生效。
- [ ] **Step 4:** ChatPanel:
  - 组件入参/环境取 `viewerIsAnonymous`(从 EditorPort/MobileEditorRoot 传 props;它们从 useChromeSession 拿)
  - `send()` 开头(stagedPhotos 分支之后、正文分支之前):`if (viewerIsAnonymous && !pendingInterview) { window.location.assign(localizePath(\`/login?from=/album/${albumId}\`, locale)); return; }` —— 注意:采访答题(pendingInterview)是讲故事环节,匿名放行;只有走到 runDesignChatTurn/runEdit 的自由输入才拦
  - runDesignChatTurn 的 `!res.ok` 分支加 `ANON_UPGRADE_REQUIRED` → `throw new UnauthorizedError()`
  - 自动补跑:挂载后(拿到 album detail 与 pages 后)`if (!viewerIsAnonymous && detail.album.copySource === 'placeholder' && !composing)`:从 pages 恢复 set(cover 页 templateId+images 首值、ending 同理、design.pageBackground),`selectLayoutRefsFromStore(albumRecipe.photoIds)` 取 refs,直接调 `runApplyDesign(recoveredSet, pageBackground)` 的内核(复用现函数,跳过卡片 UI;thinking 文案 aT('登录成功!正在照你讲的故事写真文案…','Signed in — writing your real story…'));一次性防重入 flag
- [ ] **Step 5:** EditorPort:
  - `const viewerIsAnonymous = session.user?.isAnonymous ?? false`(useChromeSession 已挂)
  - `backupPhotos()` / `shareLink()` 入口第一行:`if (viewerIsAnonymous) { window.location.assign(localizePath(\`/login?from=/album/${albumId}\`, locale)); return; }`
  - `exportPdf()`:上传段 `if (!viewerIsAnonymous) await runExportWithRetry(() => uploadPdfOnce(blob!), ...)`;cover-thumbnail 上传若在导出/保存链路同样条件跳过(实施时 grep `cover-thumbnail` 调用点)
  - `usePhotoOriginalSync({..., enabled: !viewerIsAnonymous })`(1425-1431)
  - ChatPanel 挂载处传 `viewerIsAnonymous`
- [ ] **Step 6:** MobileEditorRoot:同样取 isAnonymous(补 useChromeSession 或从上层传);`runBackup`/`onShare` 前置跳登录;`usePhotoOriginalSync` enabled 反转(655-659);use-export.ts `exportPdf` 接 `skipUpload: boolean`,匿名时不调 `uploadPdf`;ChatPanel props 透传
- [ ] **Step 7:** UserMenu:`user.isAnonymous` → 渲染「登录 / Sign in」链接(`/login?from=当前路径`),不渲染邮箱/积分/登出;messages 两语言加 `dashboard.chrome.signIn`
- [ ] **Step 8:** settings/credits/my-albums 三个 server page:session 有但 `userRepo.findById(...).isAnonymous` → `redirect(localizePath('/login?from=...', locale))`(抽一个 `apps/web/src/lib/auth/redirect-anon.ts` 小 helper 三处用)
- [ ] **Step 9:** anon-ui-gate.test.ts 源码断言:EditorPort 含 `viewerIsAnonymous` 且 uploadPdfOnce 调用被条件包裹;use-export 含 skipUpload;HeroComposer 含 `signIn.anonymous`;ChatPanel 含 copySource === 'placeholder' 自动补跑标记
- [ ] **Step 10:** typecheck + 相关测试过,commit

---

### Task 9: 匿名清理 cron

**Files:**
- Create: `apps/web/src/app/api/v1/admin/cleanup-anon/route.ts`(照 cleanup-photos 全抄形态:GET cron query / POST admin body,olderThanDays 1..365 默认 ANON_CLEANUP_DAYS)
- Modify: `apps/web/src/services/admin/admin-service.ts` 加 `cleanupAnonymous(actorId, opts)`
- Modify: `apps/web/src/db/repos/user-repo.ts` 加 `findAnonymousCreatedBefore(cutoff, limit=500)` 与 `deleteById(tx, id)`
- Modify: `apps/web/vercel.json` crons 追加 `{"path": "/api/v1/admin/cleanup-anon", "schedule": "0 2 * * *"}`
- Test: admin-service 测试文件扩

- [ ] **Step 1:** `cleanupAnonymous`:找 `isAnonymous && createdAt < cutoff` 的用户,事务里逐个 `tx.delete(users).where(...)`(11 处 cascade 带走 albums/messages/jobs),返回 `{ scanned, deleted }`,logger.info 审计
- [ ] **Step 2:** route + vercel.json
- [ ] **Step 3:** 集成测试:造 8 天前匿名用户(手工 upsert createdAt)+ 相册 → cleanup → 用户与相册消失;真实用户与新匿名用户不受影响
- [ ] **Step 4:** 测试过,commit

---

### Task 10: 文档 + checked-at 收账

**Files:**
- Modify: `apps/web/README.md`(鉴权一节补游客模式两档门禁 + 限流常量表;环境变量表无新增则不动)
- Modify: `CLAUDE.md` / `README.md`(根)若其鉴权/流程描述与新行为冲突则改写
- Modify: 4 个漂移文件的 `checked-at`(CLAUDE.md、README.md、apps/web/README.md、packages/design-agent/README.md)——先核对内容属实再 bump 到当前提交
- Modify: `docs/superpowers/specs/2026-08-04-anon-guest-flow-design.md` 若实施中口径有变(如占位文案来源改为「模板 sample 已有」)同步订正

- [ ] **Step 1:** 核对 + 改写 + bump;`node scripts/docs-check.mjs` 全绿
- [ ] **Step 2:** 部署侧行动项写进 README 部署注意(或 PR 描述):Vercel WAF 对 `/api/auth/sign-in/anonymous` 与 `POST /api/v3/albums` 加 IP 限流规则(仓外配置);生产 psql 应用 0025 由 vercel build 的 db:migrate 处理(journal 已补)
- [ ] **Step 3:** commit

---

### Task 11: 全量验证

- [ ] `pnpm --filter @yujee/web test` 全绿(基线 1479 pass)
- [ ] `pnpm typecheck` 全绿(docs:check 含 Task 10 之后)
- [ ] `pnpm --filter @yujee/contracts typecheck`、`pnpm templates:check` 绿
- [ ] 回归重点手查:已登录用户建书全流程代码路径无行为变化(applyDesign 非 placeholder 分支、credit hold/settle 时序、design-chat)
- [ ] 汇总报告(改动清单、迁移应用方式、部署行动项、已知边界:邮箱验证跨设备转正不生效由 7 天清理兜底)
