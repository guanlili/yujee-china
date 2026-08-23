# Yujee Web

Next.js app for the product UI, auth, billing, album state, V3 orchestration, and browser-owned export flow.

## Responsibilities

- User-facing pages and editor shell.
- Auth through `better-auth`.
- Billing/credits through Waffo Pancake(`@waffo/pancake-ts` SDK,RSA 验签,主通道,
  2026-08 起替换 Creem;`POST /api/v1/billing/checkout` 统一发起,webhook 落
  `POST /api/webhooks/waffo`;Creem 及其 `POST /api/webhooks/creem` 留作 Phase 1
  在途订单兜底,不再是发起 checkout 的通道)and the credit ledger.
- 游客模式(匿名影子账号,anonymous 插件):落地页点「发送」即静默建号,免登录走完
  建相册 → CLIP 分组 → 讲故事 → 选版 → 确认封面(**占位成稿**:内页保留模板 sample,
  封面/封尾也全量落模板 sample(含非标题槽)—— 占位书本来就明示是「示例」,不存在印
  模板作者年份地名的顾虑,靠它撑住游客的第一印象;真成稿路径只兜标题槽不变,
  见 `design-apply.ts` 的 `coverTextBase`/`placeholderCoverTextBase`),
  `albums.copy_source='placeholder'`,零 AI/零积分/零 R2)→ 本地导出。只有三件事要
  真实账号:对话改书(design-chat)、保存(照片快照)、分享 —— API 层 `requireRealUser`
  403 `ANON_UPGRADE_REQUIRED`,前端统一弹登录。登录时 `onLinkAccount` 过户相册并删匿名
  号,前端检测 `copySource='placeholder'` 自动重发 POST /design 补跑真 compose(此时才
  precheck+hold 计费)。游客硬上限:20 张/本、1 本/号、匿名注册每 IP 每小时 5 次
  (`src/config/anon.ts`)。清理只扫**一本书都没做**的空游客(超 7 天未转正,cron
  `/api/v1/admin/cleanup-anon`);**做过书的游客永久保留** —— 他传过照片、等过生成、
  翻过成品,是转化漏斗上最强的意向信号,删掉等于连召回话术一起扔了。后台用户列表
  因此有三态视图(正式用户 / 全部 / 做了书没注册),相册数可点进只读预览
  (`/{locale}/admin/albums/[uuid]`,`adminService.previewAlbum`,照片走 photo-originals
  私有桶预签名,不依赖用户主动保存的分享快照)。
- Album/job persistence in Postgres via Drizzle.
- Album-level default and per-photo override filter persistence in `albums.photo_filter`.
- Browser -> Web -> Agent orchestration for V3 generation.
- Callback handling from Agent.
- R2 presigned URLs for PDF, thumbnails, and immutable versioned display-photo snapshots.

Web 调**两个**后端服务,别混:

| | 生成 Agent | 设计 Agent |
|---|---|---|
| 客户端 | `src/lib/agent/agent-client.ts` | `src/lib/agent/design-agent-client.ts` |
| 环境变量 | `AGENT_BASE_URL` / `AGENT_SHARED_SECRET` | `DESIGN_AGENT_BASE_URL` / `DESIGN_AGENT_SHARED_SECRET` |
| 响应信封 | `{ok,data}` | 直接 JSON |
| 端点 | `/health`、`/v3/analyze`、`/v3/select-layout`、`/v3/compose` | `/health`、`/api/book`、`/api/chat`、`/api/albums\|traces\|state` |
| Web 侧入口 | `src/app/api/v3/albums/**`(生成编排) | `src/app/api/v3/albums/[uuid]/design-chat/route.ts` |

`agent-client.ts` 只剩三个 submit 方法(`submitAnalyzeV3` / `submitSelectLayoutV3` /
`submitComposeV3`)。旧的 `chapter-chat` / `edit-chat` / `recommend` / `apply-theme` /
`cover` / `finalize` 确实已经没有 Web 路由,残留的只是测试文件与 CSS 里的历史注释 ——
**但"对话改书"这个能力没有消失,它搬到了 design-chat + 设计 Agent 上**,不要因为旧端点
被删就认定该能力不存在。

改动任何调后端的 Web 路由前,先看对应服务的真实 surface:
`engine/src/api/routes.py` 或 `packages/design-agent/src/web/album-server.ts`。

## Directory Map

```text
apps/web/
├── src/app/[locale]/          # Pages, localized routes, album editor entry
├── src/app/api/v1             # Existing product APIs: albums, pdf, credit, user, admin
├── src/app/api/v3             # Generation/orchestration APIs
├── src/components/album       # Album editor, templates, rendering components
├── src/lib
│   ├── agent                  # Agent HTTP client and contract parsing
│   ├── generation             # Browser generation client helpers
│   ├── photo                  # Compression, HEIC, clustering, thumbnails, local store
│   ├── pdf                    # Browser/PDF rendering helpers
│   ├── auth / billing / r2    # External service boundaries
│   └── api                    # Error/response helpers
├── src/services               # Business services: album, job, generation, credit, billing
└── src/db                     # Drizzle schema, repos, migrations
```

## Generation Flow

```text
Browser photos(压缩后的轻量图像数据 + EXIF 时间/GPS + 本地聚类标签)
  -> POST /api/v3/albums
  -> generationService.submitAnalyzeV3
  -> Agent /v3/analyze              (纯确定性分组,零 AI 调用)
  <- /api/v3/internal/job-progress callback with V3LayoutTree
                                    (chapter.title 由拍摄时间跨度确定性派生)

story 环节:用户逐章讲故事 -> chapter.chapterContext
  -> POST /api/v3/albums/[uuid]/chapter-context

采访结束 + Browser 200px refs
  -> POST /api/v3/albums/[uuid]/select-layout
  -> Agent /v3/select-layout        (一次确定性选版,零 AI 调用)
  <- completed callback with Page[](texts 先填模板 sample 示例文案,
     所以用户看到的是有字的版面,不是空文字框)

设计卡:用户选封面/封尾组合 + 书页底色(文字三色确定性恒黑,不问模型)
  -> POST /api/v3/albums/[uuid]/design
  -> albumService.applyDesign 建 agent_jobs.kind='compose' 的 job 并**异步派发**
  -> Agent /v3/compose               (202 + callback;全链路唯一的 AI 调用:
     按章并发让 Gemini 看真实照片 + 读用户讲的故事写满全书文案 + 封面/封尾文案 + 字体)
  <- progress 心跳(逐章)…
  <- completed callback: pagesTexts + coverTexts/endingTexts + fonts
     -> jobService.handleV3ComposeCompleted 组页落库 + 推 stage='ready'
```

候选缩略图 / 视觉评委那条链路已整条删除:浏览器不再渲染排版候选缩略图回传给 Agent 评选,
同步的 `/v3/design` 也已被异步 `/v3/compose` 取代。

**加照片后的追加范围成稿**(已设计的书专用):`services/album/append-photos.ts` 增量排版
落地、合并出新页(继承设计 carrier + 模板 sample 文案)之后,前端自动
`POST /api/v3/albums/[uuid]/compose-append` → `albumService.composeAppend` 只为新章建
`kind='compose'` job、转发一份**空 `coverSlots`/`endingSlots`、只含新章**的 `/v3/compose`
请求(Agent 侧全局批次因此跳过,不写封面不动字体)。回调 `handleV3ComposeCompleted` 按
`agent_jobs.meta.composeAppend` 走缩小版分支:合并前先按**当前** draft 核对每个
`pageIndex` 的照片归属(章归属守卫,`filterAppendComposePagesTexts`)——compose 在 Agent
侧跑的这几分钟里页序可能被 `reorderPages` / 设计 Agent 的 `move_pages` 重排,与派发范围
无交集的页跳过不写,防止把新章文案写进一个此刻其实是老页的位置;真正合并的页数回填进
`agent_jobs.meta.composeAppend.writtenPages`,`stage`/封面/字体/其余页一律不动。
`GET /api/v3/albums/[uuid]/design` 新增 `lastComposeStatus`(job 状态)与
`lastComposeWrote`(是否真写出了页,`writtenPages>0`;非追加单/未完成 → `null`)供前端
轮询区分「COMPLETED 但整章掉队」与「真写好了」。`composeAppend` 撞在途唯一索引时只有
在途单确实是同 scope(或范围更宽)的追加成稿才当幂等重入,否则 `VALIDATION_FAILED`
(不会把撞上全书成稿/别的追加范围的本批章无声吞掉)。书未设计(没有封面/封尾 carrier)
时 `composeAppend` 直接返回 `composed:false`,不建 job、不调 Agent —— 新页文案维持等选
封面时随全书成稿一起写的现状。

Key files:

- `src/lib/generation/client.ts`: browser-side submit/retry/select-layout helpers.
- `src/services/generation/generation-service.ts`: creates jobs, reserves the layout job, calls Agent.
- `src/services/album/album-service.ts` (`applyDesign` / `composeAppend`): 前者校验设计选择、
  建 `compose` job 并派发全书成稿;后者给已设计的书追加照片后建同 kind 的窄口径 job。
- `src/app/api/v3/albums/[uuid]/compose-append/route.ts`: 追加范围成稿路由薄壳。
- `src/services/album/design-apply.ts`: 设计环节的确定性应用层(封面组规则、carrier sweep、
  组页、字体兜底),零 AI。
- `src/app/api/v3/internal/job-progress/handler.ts`: Agent callback sink。

## Browser Data Boundary

- **建书照片直传 R2**(照片字节永不进 Vercel 请求体)。曾经 `POST /api/v3/albums` 把每张
  800px 预览的 base64 内联进 body,27~50 张就撞 Vercel 4.5MB 的
  `FUNCTION_PAYLOAD_TOO_LARGE`(413,且响应体是 text/plain,客户端 `res.json()` 直接抛
  SyntaxError)。现在分两步:
  1. `POST /api/v3/albums/upload-urls` —— 只收 photoId 列表,回一个服务端签发的
     `uploadSessionId` + 每张一个 30 分钟的预签名 PUT。**不建书、不扣积分、不写库**,
     所以用户中途放弃不会留下空相册和挂着的 hold;游客同路(`getAuthUser`),但在这里
     就按 `ANON_MAX_PHOTOS_PER_GENERATION` 卡住,免得这个端点变成纯写 R2 的白嫖通道。
  2. `POST /api/v3/albums` —— body 只带 `uploadSessionId` + 元信息(100 张约 12KB)。
     服务端在**建库之前**从 R2 取回字节(`analyzeUploadService.collect`),拼成与内联
     时代一模一样的 `V3AnalyzeRequest` 转发 agent,engine 侧零改动。少一张就抛
     `ANALYZE_UPLOAD_INCOMPLETE`(409,只回个数不回 photoId),不留半本书。
  - key:`analyze-uploads/{userId}/{uploadSessionId}/{photoId}.jpg`。单张 ≤800KB,与旧
    路径的 `V3AnalyzeImageDataUrl` 同一道闸(预签名 PUT 本身不带体积约束,所以这道闸
    在读回来时补)。
  - **运维前置:R2 上必须给 `analyze-uploads/` 前缀配生命周期规则(建议 1 天过期)。**
    字节在建书成功后几分钟内就被消费完,应用层不删它们;中途放弃的上传、以及每次
    重试都会换新 `uploadSessionId` 留下的上一轮对象,全靠这条规则回收。没配就是无上限
    的存储成本。
  - `POST /api/v3/albums/[uuid]/retry` **不走**这条路:它仍把全书照片内联重发,用的是
    `RetryBodySchema`(base64 必填),因此仍受 4.5MB 限制,大书重试会 413。要治的话最
    省事的走法是让它也从 R2 读 —— 字节建书时已经在那儿了。
- The canonical photo original is now a compressed, unfiltered JPEG derivative (long
  edge 3400px, q0.82, built by `store.ts`'s `getCanonicalUploadBlob`) uploaded to a
  private R2 bucket at `photo-originals/{albumId}/{photoId}.jpg` via presigned PUT +
  confirm; private reads use `r2.signGetUrl` (300s TTL). The raw camera file itself
  still never leaves the browser.
- `src/lib/photo/compress.ts` creates upload-sized image data.
- `src/lib/photo/store.ts`'s IndexedDB `originals` store is a **cache**, not the sole
  holder: `getBlob` falls back to an injected `RemoteOriginalFetcher` on local miss
  (in-flight dedup; `boardbg-`-prefixed and otherwise-invalid ids are excluded from
  remote fallback) and backfills the cache via `toMemoryBackedBlob`.
- `src/lib/photo/cluster.ts` derives opaque grouping labels.
- `src/lib/photo/lut/engine.ts` is browser-only. Unsupported WebGL/resource/render
  failures keep the exact original/base blob and log a diagnostic warning; Web and
  both Agents never process photo-filter pixels.
- PDF/JPG/Live exports, manual snapshots, and cover thumbnails all resolve the same
  effective filter in the browser; Web only persists state and issues R2 presigned URLs.
- `usePhotoOriginalSync` (wired into editor-v2 `EditorBook` in `EditorPort.tsx` and
  into `MobileEditorRoot`) runs on mount: probes the server-uploaded set via
  `.../photo-originals/urls` (chunked 300), uploads only the delta (batch 50, PUT
  concurrency 3), and confirms any still-missing entries. Resumable and idempotent —
  every run re-probes before uploading, so a photoId already confirmed server-side is
  skipped and a partial run just leaves it in the next diff.

## Photo Filters and Derived Artifacts

`albums.photo_filter` stores one normalized book default plus optional per-photo
overrides; an explicit `null` override means original. Strength is quantized to 5%
steps, and `effectiveRenderVersion` produces one stable `pf-v1` version per photo.
The closed 26-LUT manifest lives in `src/lib/photo/filter-state.ts`. Generated static
assets are deterministic: one combined 17³ thumbnail payload plus 26 individual 33³
full payloads under `public/luts/`; source `.cube` files are intentionally not tracked.

抠图(cutout)与 LUT 并列,同住 `albums.photo_filter` 的 `cutouts` 记录里 —— 一个真相源、
一次行锁、一个 normalize。它**只认 `true`**,关掉是删键(允许 `false` 会让「没抠」有两种
表示,`renderVersion` 与派生缓存 key 立刻有歧义),且没有 album 级默认值。派生管线里的
顺序是**先 LUT 后抠图**(LUT 要在完整 RGB 上算);抠图产物带 alpha,所以快照存 WebP
而不是 JPEG。算法在 `src/lib/photo/cutout/cutout-math.ts`(边缘漫水填充,浏览器内跑,
不上传照片、零边际成本),引擎抠不动时原样退回原图。已知局限:主体与背景同色、或背景
杂乱时基本吃不动 —— 这是像素法的天花板,接口留窄了,换分割模型只动 `cutout-math.ts`。

Changing the filter row-locks the album, persists only normalized filter state,
invalidates stored PDF and cover-thumbnail metadata, and moves a `COMPLETED` album
back to `EDITING`. Cover thumbnail signing returns an opaque SHA-256
`coverRevision` bound to normalized filter state, album `updatedAt`, and page 0.
The immutable key is
`cover-thumbs/{userId}/{albumId}/{coverRevision}.jpg`; confirmation re-locks and
recomputes the revision, so a stale upload cannot replace a newer cover state.

## Public Share Snapshots

`POST /api/v1/albums/[uuid]/share` freezes a new public share from one consistent
album state. The service holds the album row lock while checking ownership, reading
the current draft/final pages, comparing every referenced photo's recorded snapshot
version with its effective filter render version, and upserting `album_shares`.
Frozen `photoUrls` contain only page-referenced photos and always use immutable
versioned R2 keys.

Both snapshot endpoints accept only
`{ entries: [{ photoId, renderVersion }, ...] }`. The browser PUTs exact filtered
display JPEGs to
`photo-snapshots/{userId}/{albumId}/{photoId}/{renderVersion}.jpg`; confirmation
records only successful entries. Legacy unversioned rows remain readable for album
fallback display, but they never satisfy creation of a new share.

If any referenced photo lacks the exact current version, the endpoint returns
`409 PHOTO_SNAPSHOT_VERSION_MISSING`; its message is only the numeric missing count
(never photo IDs or render versions). Desktop and mobile translate that code/count
to localized backup guidance. The failed attempt does not replace an existing share
token or snapshot, and public reads never mutate already-frozen shares.

## Page HTML Truth (C 方案)

- 排版/设计落库时每页烘成 HTML(`services/album/bake-html.ts`),draft 页的 `html`
  是页面唯一真相;读路径对存量 draft 现场烘 —— draft_pages 拆表后编辑器读点走
  `loadStoryDraft`(行优先,`bake:true` 保持兜底烘制),legacy 路径仍是 `readStoryDraft`。
- 画板(PagePreview/FlipBook)优先渲染存库 html(`components/album/page-html-dom.ts`
  解析 `{{IMG_SRC}}` token → blob URL);无 html 回退模板即时渲染,再缺回退 React 组件。
- 用户改字走 html 原位补丁(锚点 `data-text-key`),AI/用户手工版面不被覆盖;
  换模板/主题一键会从模板重烘(手工版面重置,属预期)。
- PDF 导出只剩栅格路径(`lib/pdf/render-raster.ts`,html2canvas 截存库 html);
  矢量 PDF 路径已退役。
- **改模板不会自动修好老书**:`bakePageHtml` 对已带 `html` 的页直接跳过,存量页永远
  停在烘制那一刻的模板形态。模板几何出过错(如 mag-09 的槽被外层定位推出页面)时,
  老书要靠一次性维护接口补,且必须走**外科式补丁**而不是清空重烘 —— 重烘会抹掉用户改过
  的字/颜色/字体和 design-agent `write_page_html` 写下的手工版面。先例:
  `services/album/repair-mag09-html.ts`(纯字符串补丁)+ `repair-mag09-pages.ts`
  (扫三处存储:`draft_pages.page.html`、`albums.draft_json.pages[].html`、
  `album_shares.snapshot_json.pages[].htmlJson`;定稿的 `album_pages` 不存 html、
  读时现渲,自动吃到修复)+ `api/v1/admin/repair-mag09-pages`(默认 dry-run,
  `?apply=1` 才写库,幂等)。

## Database Boundary

Drizzle schema lives in `src/db/schema.ts`.

Core tables:

- `albums`: album status, stage, draft/final layout JSON, normalized `photo_filter`,
  versioned photo-snapshot metadata, PDF/cover derivative metadata.
- `album_photos`: per-photo canonical-original upload state — composite PK
  `(albumId, photoId)`, `status` (`uploaded`/`missing`), `width`/`height`/`bytes`.
  `upsertMany` never downgrades an existing `uploaded` row back to `missing`
  (CASE-guarded). `countByStatus` backs `getDetail`'s
  `photoOriginals: {uploaded, missing}` projection, which feeds `albumLiveSignature`
  polling. Deleting an album row-locks and deletes its `album_photos` rows in the
  same transaction.
- `album_pages`: finalized page rows.
- `album_messages`: conversation/history rows where still used by Web.
- `agent_jobs`: async Agent job state and callback progress。`kind` 枚举在迁移 `0020` 里
  新增了 `'compose'`;PG 不允许在同一个事务里使用刚加的枚举值,而 drizzle 把待跑迁移放进
  同一个事务,所以将来任何引用 `'compose'` 的迁移(写数据、加带该值的约束/索引/默认值)
  必须与 0020 **分批部署**:0020 先单独跑完提交,下一批再跑用到 `'compose'` 的迁移。
- `credit_holds` / `credit_ledger`: generation credit accounting.
- `users`, `sessions`, `accounts`, `verifications`: better-auth tables.
- `customers`, `subscriptions`: billing provider mapping(Creem/Stripe 用;Waffo 无
  customer id 概念,checkout/webhook 只有 `buyerEmail`,不读写这两张表,`customer_provider`
  枚举也未追加 `'waffo'`)。

Routes should stay thin: auth, parse body, call a service, return `ok()` or `fromException()`. Business rules belong in `src/services/*`; direct DB access belongs in repos.

## Commands

```bash
pnpm --filter @yujee/web dev
pnpm --filter @yujee/web typecheck
pnpm --filter @yujee/web sitemap:check   # sitemap lastmod 时效,见 src/lib/seo/freshness.ts
pnpm --filter @yujee/web db:generate
pnpm --filter @yujee/web db:migrate
```

跑 Web 测试(两种等价,`--filter` 会把 cwd 设成本包目录,env 照常加载):

```bash
cd apps/web && pnpm test
pnpm --filter @yujee/web test    # 从仓根跑,等价
```

**真正要小心的是仓根的 `pnpm test`**(即 `pnpm -r test`):它撞到第一个失败的包就中断,
后面的包一个都不跑。contracts 先失败时,web 这 700+ 个测试根本没机会执行,而输出看起来
"只坏了一处"。改了 web 就明确跑上面两条之一,别拿仓根 `pnpm test` 的结果替代。

如果确实看到大量 `DATABASE_URL is not reachable; skipping`,那是本地缺 `apps/web/.env.local`
或库没起,不是跑法问题 —— 那种情况下真库集成测试会假跳过,输出一片绿但一条 DB 断言都没跑。

## Environment

Defaults live in `src/lib/env.ts`. Common fields:

| Name | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection |
| `AGENT_BASE_URL` | 生成 Agent base URL, default `http://localhost:8001` |
| `AGENT_SHARED_SECRET` | Bearer secret shared with 生成 Agent |
| `DESIGN_AGENT_BASE_URL` | 设计 Agent base URL, default `http://localhost:8787` |
| `DESIGN_AGENT_SHARED_SECRET` | Bearer secret shared with 设计 Agent(未设则不带鉴权头) |
| `WEB_BASE_URL` | Web origin used in callbacks |
| `BETTER_AUTH_SECRET` | Auth signing secret |
| `WAFFO_*` | Billing(主通道,2026-08 起) |
| `CREEM_*` | Billing(仅在途订单 webhook 兜底) |
| `R2_*` | PDF/thumbnail storage,以及 AI 生图产出的原图 |
| `IMAGE_PROVIDER` | AI 生图走哪家:`gemini`(默认,生产)/ `ark`(本地开发更快) |
| `GEMINI_API_KEY` | 生图 provider = gemini 时必需;缺则生图入口返回 501 |
| `ARK_API_KEY` | 生图 provider = ark 时必需;同时给 `scripts/gen-board-bg.ts` 用 |

**真生产**下,这七个变量必须显式提供,缺任何一个当场抛(一次报全):
`DATABASE_URL` · `WEB_BASE_URL` · `BETTER_AUTH_SECRET` · `AGENT_BASE_URL` ·
`AGENT_SHARED_SECRET` · `DESIGN_AGENT_BASE_URL` · `DESIGN_AGENT_SHARED_SECRET`。
这是刻意的:漏配一个 Vercel 变量应该当场崩,而不是带着 `dev_secret_replace_me` 静默上线。

「真生产」的判定是 `VERCEL_ENV === 'production'`,**不是 `NODE_ENV`** —— Vercel 的
preview/development 构建同样跑在 `NODE_ENV=production` 下,只看 NODE_ENV 会让每个 PR
预览构建都炸(Preview 环境本就缺 `DATABASE_URL`)。没有 `VERCEL_ENV` 时(Fly/Docker
自托管)才回落到 `NODE_ENV`。本地 dev/test 完全不受影响,零配置仍然起得来。
实现与测试:`src/lib/env.ts` 的 `assertProductionEnv` / `src/lib/env.test.ts`。

另有两条条件性守卫,不在上面那七个的无条件清单里:

真生产一旦配了 `WAFFO_MERCHANT_ID`(代表 Waffo 已启用),`WAFFO_ENV` 就必须显式设成
`'prod'`,否则当场抛。`WAFFO_ENV` 在 schema 里默认 `'test'`;真实的漏配现场**不是**
"mode 门静默 ack"——`handleWebhook` 调 `verifyWebhook` 时显式传
`{ environment: env.WAFFO_ENV }`,SDK 只会用该环境对应的公钥验签,不会像省略
`environment` 时那样自动兼容试另一把。live 事件是拿 prod 私钥签的,拿 test 公钥验会
直接签名失败,返回 `400` + 一行 `'waffo webhook signature failed'` warn 日志——根本
走不到 mode 门那步比较。Waffo 那头对非 2xx 只指数退避重试 3 次,之后整条 delivery
标记 `failed`:买家扣了钱却拿不到积分,而且只能去 Waffo dashboard 的 webhook 日志
里才看得到这条失败记录。

同样地,真生产配了 `WAFFO_MERCHANT_ID` 且 `WAFFO_ENV='prod'` 时,还必须配
`WAFFO_STORE_ID`,否则同样当场抛。`WAFFO_STORE_ID` 是 webhook 的租户边界安全控制——
`waffo-service.handleWebhook` 的 store 门是 fail-closed(未配置或配置了却不匹配,都
拒收并各自 error 日志),漏配不会像其它变量那样连错服务,而是所有 webhook 事件被
拒收、不发积分。

## Change Notes

- Keep browser-only photo/GPS logic out of server services.
- Do not store base64 image payloads in Postgres or R2.
- Keep Web as the owner of album/job persistence and callback merging.
- 改动调后端的 Web 路由前,先看对应服务的真实 surface(`engine/src/api/routes.py` 或
  `packages/design-agent/src/web/album-server.ts`);已删的端点不要当成在用的行为写进文档。
- Web 与两个 Agent 必须同版本部署。跨服务契约是手工镜像、无 codegen,只部署一边会契约漂移。
  Web 走 Vercel 自动部署,两个 Agent 都要**手动** `flyctl deploy`。

<!-- doc-scope
paths: apps/web/src/app/api/**, apps/web/src/lib/agent/**, apps/web/src/lib/env.ts, apps/web/src/services/**, apps/web/package.json
checked-at: ed9a25e6
-->
