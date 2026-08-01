# Yujee Web

Next.js app for the product UI, auth, billing, album state, V3 orchestration, and browser-owned export flow.

## Responsibilities

- User-facing pages and editor shell.
- Auth through `better-auth`.
- Billing/credits through Creem and the credit ledger.
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

Key files:

- `src/lib/generation/client.ts`: browser-side submit/retry/select-layout helpers.
- `src/services/generation/generation-service.ts`: creates jobs, reserves the layout job, calls Agent.
- `src/services/album/album-service.ts` (`applyDesign`): 校验设计选择,建 `compose` job 并派发。
- `src/services/album/design-apply.ts`: 设计环节的确定性应用层(封面组规则、carrier sweep、
  组页、字体兜底),零 AI。
- `src/app/api/v3/internal/job-progress/handler.ts`: Agent callback sink。

## Browser Data Boundary

- Original photos stay in the browser.
- `src/lib/photo/compress.ts` creates upload-sized image data.
- `src/lib/photo/store.ts` keeps local originals for retry/resume and stores bounded
  filter-derived display/thumb variants without mutating those originals.
- `src/lib/photo/cluster.ts` derives opaque grouping labels.
- `src/lib/photo/lut/engine.ts` is browser-only. Unsupported WebGL/resource/render
  failures keep the exact original/base blob and log a diagnostic warning; Web and
  both Agents never process photo-filter pixels.
- PDF/JPG/Live exports, manual snapshots, and cover thumbnails all resolve the same
  effective filter in the browser; Web only persists state and issues R2 presigned URLs.

## Photo Filters and Derived Artifacts

`albums.photo_filter` stores one normalized book default plus optional per-photo
overrides; an explicit `null` override means original. Strength is quantized to 5%
steps, and `effectiveRenderVersion` produces one stable `pf-v1` version per photo.
The closed 26-LUT manifest lives in `src/lib/photo/filter-state.ts`. Generated static
assets are deterministic: one combined 17³ thumbnail payload plus 26 individual 33³
full payloads under `public/luts/`; source `.cube` files are intentionally not tracked.

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
  是页面唯一真相;读路径对存量 draft 现场烘(`readStoryDraft`)。
- 画板(PagePreview/FlipBook)优先渲染存库 html(`components/album/page-html-dom.ts`
  解析 `{{IMG_SRC}}` token → blob URL);无 html 回退模板即时渲染,再缺回退 React 组件。
- 用户改字走 html 原位补丁(锚点 `data-text-key`),AI/用户手工版面不被覆盖;
  换模板/主题一键会从模板重烘(手工版面重置,属预期)。
- PDF 导出只剩栅格路径(`lib/pdf/render-raster.ts`,html2canvas 截存库 html);
  矢量 PDF 路径已退役。

## Database Boundary

Drizzle schema lives in `src/db/schema.ts`.

Core tables:

- `albums`: album status, stage, draft/final layout JSON, normalized `photo_filter`,
  versioned photo-snapshot metadata, PDF/cover derivative metadata.
- `album_pages`: finalized page rows.
- `album_messages`: conversation/history rows where still used by Web.
- `agent_jobs`: async Agent job state and callback progress。`kind` 枚举在迁移 `0020` 里
  新增了 `'compose'`;PG 不允许在同一个事务里使用刚加的枚举值,而 drizzle 把待跑迁移放进
  同一个事务,所以将来任何引用 `'compose'` 的迁移(写数据、加带该值的约束/索引/默认值)
  必须与 0020 **分批部署**:0020 先单独跑完提交,下一批再跑用到 `'compose'` 的迁移。
- `credit_holds` / `credit_ledger`: generation credit accounting.
- `users`, `sessions`, `accounts`, `verifications`: better-auth tables.
- `customers`, `subscriptions`: billing provider mapping.

Routes should stay thin: auth, parse body, call a service, return `ok()` or `fromException()`. Business rules belong in `src/services/*`; direct DB access belongs in repos.

## Commands

```bash
pnpm --filter @yujee/web dev
pnpm --filter @yujee/web typecheck
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
| `CREEM_*` | Billing |
| `R2_*` | PDF/thumbnail storage |

**真生产**下,这七个变量必须显式提供,缺任何一个当场抛(一次报全):
`DATABASE_URL` · `WEB_BASE_URL` · `BETTER_AUTH_SECRET` · `AGENT_BASE_URL` ·
`AGENT_SHARED_SECRET` · `DESIGN_AGENT_BASE_URL` · `DESIGN_AGENT_SHARED_SECRET`。
这是刻意的:漏配一个 Vercel 变量应该当场崩,而不是带着 `dev_secret_replace_me` 静默上线。

「真生产」的判定是 `VERCEL_ENV === 'production'`,**不是 `NODE_ENV`** —— Vercel 的
preview/development 构建同样跑在 `NODE_ENV=production` 下,只看 NODE_ENV 会让每个 PR
预览构建都炸(Preview 环境本就缺 `DATABASE_URL`)。没有 `VERCEL_ENV` 时(Fly/Docker
自托管)才回落到 `NODE_ENV`。本地 dev/test 完全不受影响,零配置仍然起得来。
实现与测试:`src/lib/env.ts` 的 `assertProductionEnv` / `src/lib/env.test.ts`。

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
checked-at: 440d6bf6
-->
