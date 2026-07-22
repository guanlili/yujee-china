# Yujee Web

Next.js app for the product UI, auth, billing, album state, V3 orchestration, and browser-owned export flow.

## Responsibilities

- User-facing pages and editor shell.
- Auth through `better-auth`.
- Billing/credits through Creem and the credit ledger.
- Album/job persistence in Postgres via Drizzle.
- Browser -> Web -> Agent orchestration for V3 generation.
- Callback handling from Agent.
- R2 presigned URLs for PDF and thumbnails.

Agent 对外只有四个端点:`GET /health`、`POST /v3/analyze`、`POST /v3/select-layout`、
`POST /v3/compose`。`src/lib/agent/agent-client.ts` 也只剩对应的三个 submit 方法
(`submitAnalyzeV3` / `submitSelectLayoutV3` / `submitComposeV3`)。旧的
`chapter-chat` / `edit-chat` / `recommend` / `apply-theme` / `cover` / `finalize` 都已经
没有 Web 路由,残留的只是测试文件与 CSS 里的历史注释。改动任何调 Agent 的 Web 路由前,
先看 `engine/src/api/routes.py`;已删的 Agent 路由不要当成在用的行为写进文档。

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
- `src/lib/photo/store.ts` keeps local originals for retry/resume.
- `src/lib/photo/cluster.ts` derives opaque grouping labels.
- PDF export is browser-side; Web only issues R2 presigned URLs.

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

- `albums`: album status, stage, draft/final layout JSON, PDF metadata.
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

**跑测试必须 `cd apps/web` 之后再跑**:

```bash
cd apps/web && pnpm test
```

从仓根跑(`pnpm test` / `pnpm --filter @yujee/web test`)加载不到 `apps/web/.env`,
`DATABASE_URL` 拿不到,`src/db/repos/*.test.ts` 这类真库集成测试会**假跳过** ——
输出一片绿,实际一条 DB 断言都没跑。看到大量 `DATABASE_URL is not reachable; skipping`
就是踩了这个坑。

## Environment

Defaults live in `src/lib/env.ts`. Common fields:

| Name | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection |
| `AGENT_BASE_URL` | Agent base URL, default `http://localhost:8001` |
| `AGENT_SHARED_SECRET` | Bearer secret shared with Agent |
| `WEB_BASE_URL` | Web origin used in callbacks |
| `BETTER_AUTH_SECRET` | Auth signing secret |
| `CREEM_*` | Billing |
| `R2_*` | PDF/thumbnail storage |

## Change Notes

- Keep browser-only photo/GPS logic out of server services.
- Do not store base64 image payloads in Postgres or R2.
- Keep Web as the owner of album/job persistence and callback merging.
- When changing a Web route that calls Agent, check `engine/src/api/routes.py` first; removed Agent routes should not be described as active behavior.
- Web 与 Agent 必须同版本部署:这一版删了三个 Agent 端点、新增 `/v3/compose`、
  `V3Chapter` 加了 `title`。Web 走 Vercel 自动部署,Agent 要手动 `flyctl deploy`。
