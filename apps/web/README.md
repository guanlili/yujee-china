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

The Web app currently still contains route/client surfaces for the fuller authoring flow (`chapter-chat`, `edit-chat`, `recommend`, `apply-theme`, `cover`, `finalize`). The current Agent route surface is smaller and only exposes analyze/select-layout/judge-layout, so keep Web/Agent compatibility in mind before relying on those later routes end-to-end.

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
Browser photos
  -> POST /api/v3/albums
  -> generationService.submitAnalyzeV3
  -> Agent /v3/analyze
  <- /api/v3/internal/job-progress callback with V3LayoutTree

Browser 200px refs
  -> POST /api/v3/albums/[uuid]/select-layout
  -> Agent /v3/select-layout
  <- candidates callback

Browser renders thumbnails
  -> POST /api/v3/albums/[uuid]/judge-layout
  -> Agent /v3/judge-layout
  <- completed callback with Page[]
```

Key files:

- `src/lib/generation/client.ts`: browser-side submit/retry/select-layout/judge helpers.
- `src/services/generation/generation-service.ts`: creates jobs, reserves layout phases, calls Agent.
- `src/app/api/v3/internal/job-progress/handler.ts`: Agent callback sink.
- `src/services/album/layout-candidates.ts`: transient candidate stash for browser thumbnail judging.

## Browser Data Boundary

- Original photos stay in the browser.
- `src/lib/photo/compress.ts` creates upload-sized image data.
- `src/lib/photo/store.ts` keeps local originals for retry/resume.
- `src/lib/photo/cluster.ts` derives opaque grouping labels.
- `src/lib/photo/candidate-thumbnail.tsx` renders real template thumbnails for layout judging.
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
- `agent_jobs`: async Agent job state and callback progress.
- `credit_holds` / `credit_ledger`: generation credit accounting.
- `users`, `sessions`, `accounts`, `verifications`: better-auth tables.
- `customers`, `subscriptions`: billing provider mapping.

Routes should stay thin: auth, parse body, call a service, return `ok()` or `fromException()`. Business rules belong in `src/services/*`; direct DB access belongs in repos.

## Commands

```bash
pnpm --filter @yujee/web dev
pnpm --filter @yujee/web typecheck
pnpm --filter @yujee/web test
pnpm --filter @yujee/web db:generate
pnpm --filter @yujee/web db:migrate
```

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
- When changing a Web route that calls Agent, check `engine/src/routes.py` first; removed Agent routes should not be described as active behavior.
