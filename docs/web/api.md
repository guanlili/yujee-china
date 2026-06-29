# Web API 接口清单与浏览器流程

> **前置阅读**: `CLAUDE.md` → `docs/architecture.md` → `docs/web/layering.md`
>
> 谁读这份: 写 `app/api/*` 的 route.ts,或写 UI 时需要调接口的人。
>
> **范围说明(重要)**: 这份文档是 **Web 对外 HTTP 接口的清单 + 信封约定 + 基建型路由语义**。V3 五环节 generation/authoring 的 **Web ↔ Agent 编排细节**(各 `/v3` 端点的 req/res、状态机、错误码)以 [`docs/agent/contract.md`](../agent/contract.md) + `apps/web/src/app/api/v3/**` 为权威源,本文不复制其字段;这里只列端点与浏览器侧流程骨架。

---

## 1. 接口清单(对齐 `apps/web/src/app/api/`)

端点分两组:**`/api/v3/*`** 是五环节 generation/authoring 编排路由;**`/api/v1/*`** 是仍复用的基建型路由(相册 CRUD、积分、PDF、字体、账单、admin)。旧 `/api/v2/*` 已整套删除。

### 1.1 V3 编排路由(`/api/v3`)

| Method | Path | 鉴权 | 说明 |
|---|---|---|---|
| POST   | `/api/v3/albums` | user | 建相册 + 按张扣 hold + 派发 `/v3/analyze`(异步),返回 `{ albumId, requestId }` |
| POST   | `/api/v3/albums/[uuid]/retry` | user | 失败相册复用同一 albumId 重派 analyze(浏览器重传 base64)|
| GET    | `/api/v3/albums/[uuid]/draft` | user | 读编辑器预览骨架(扁平 render 数据 + 章节区间;authoring 树不出 server)|
| GET    | `/api/v3/albums/[uuid]/story-progress` | user | 读章节故事完成度 |
| POST   | `/api/v3/albums/[uuid]/story-progress` | user | 推进章节完成度(markChapterDone)|
| POST   | `/api/v3/albums/[uuid]/chapter-chat` | user | ② 章节故事:单章引导/写作/改页 turn(同步,代理 `/v3/chapter-chat`)|
| POST   | `/api/v3/albums/[uuid]/recommend` | user | ③ 推荐全局主题 + 每章色/字体(代理 `/v3/recommend`)|
| POST   | `/api/v3/albums/[uuid]/apply-theme` | user | ③ 应用主题/章节色/字体(确定性,代理 `/v3/apply-theme`)|
| POST   | `/api/v3/albums/[uuid]/cover` | user | ④ 生成/跳过封面封尾(确定性,代理 `/v3/cover`)|
| POST   | `/api/v3/albums/[uuid]/finalize` | user | ⑤ 拍平成 `AlbumLayoutPlan` 落 `album_pages`(代理 `/v3/finalize`)|
| POST   | `/api/v3/internal/job-progress` | agent | `/v3/analyze` 与 `/v3/select-layout` 的 progress/completed/failed 回调 sink(Bearer `AGENT_SHARED_SECRET`)|

> `/api/v3/albums` 只有 `POST`(建册)。**相册列表是 `GET /api/v1/albums`**(见下),不在 v3 命名空间。

### 1.2 基建型路由(`/api/v1` 及其它)

| Method | Path | 鉴权 | 说明 |
|---|---|---|---|
| GET    | `/api/v1/albums` | user | 我的相册列表 |
| GET    | `/api/v1/albums/[uuid]` | user | 单个相册详情(状态 + 页);生成进度真相源 |
| PATCH  | `/api/v1/albums/[uuid]` | user | 改标题 |
| DELETE | `/api/v1/albums/[uuid]` | user | 删除相册 |
| PATCH  | `/api/v1/albums/[uuid]/pages/[idx]` | user | 编辑器保存单页(`imagesJson` / `textsJson` / `imagePosJson`)|
| GET    | `/api/v1/albums/[uuid]/chapters` | user | 章节列表(编辑器侧栏)|
| GET    | `/api/v1/albums/[uuid]/messages` | user | 拉章节对话历史 |
| POST   | `/api/v1/albums/[uuid]/pdf-upload-url` | user | 签 R2 PUT URL(导出 PDF)|
| PUT    | `/api/v1/albums/[uuid]/pdf` | user | 上传完成后通知服务端,`status='COMPLETED'` |
| GET    | `/api/v1/albums/[uuid]/pdf` | user | 拿当前 PDF 下载 URL |
| POST   | `/api/v1/albums/[uuid]/cover-thumbnail-upload-url` | user | 签封面缩略图上传 URL |
| PUT    | `/api/v1/albums/[uuid]/cover-thumbnail` | user | 确认封面缩略图 |
| GET    | `/api/v1/credit/balance` | user | 当前积分 |
| GET    | `/api/v1/credit/history` | user | 积分流水 |
| POST   | `/api/v1/billing/checkout` | user | 发起 Creem 支付会话 |
| GET    | `/api/v1/user/me` | user | 当前用户 |
| GET    | `/api/v1/user/billing` | user | 账单信息 |
| POST   | `/api/v1/fonts/subset` | user | PDF 字体子集化 |
| GET/POST | `/api/v1/admin/recover-stuck` | admin/cron | 回收卡死相册(`zombieSweeper`)|
| GET/POST | `/api/v1/admin/cleanup-photos` | admin/cron | 清理残留照片态 |
| GET    | `/api/v1/health` | none | 健康检查 |
| GET/POST | `/api/auth/[...all]` | better-auth | 登录/会话(better-auth handler)|
| POST   | `/api/webhooks/creem` | sig | Creem 回调(签名校验)|

> admin/cron 路由用 `requireAdminOrCron`(`lib/auth/cron-auth`),不是 `requireAuth`。Agent callback 用 `requireAgentSecret`。

---

## 2. 统一响应信封

成功:
```json
{ "ok": true, "data": { ... } }
```

失败:
```json
{ "ok": false, "error": { "code": "CREDIT_INSUFFICIENT", "message": "..." } }
```

由 `lib/api/ok.ts`(`ok(data)`)与 `lib/api/err.ts`(`err(code, message, status)`)产出;route 的 `catch` 统一交 `fromException(e)`(见 `docs/web/errors.md §4`)。错误码完整表 → `docs/web/errors.md §2`。

---

## 3. 生成 / 编辑流程(浏览器侧骨架)

> 各 `/v3` 端点的 req/res 字段、stage 状态机、failover、错误码以 [`docs/agent/contract.md`](../agent/contract.md) 为权威源。这里只给浏览器侧编排顺序。

### 3.1 ① 建册 + 分析(异步)

```
1. 浏览器选 1–100 张照片 → Canvas 压缩 800px/q0.6 → base64;Stage0 读 EXIF 只取 takenAt
2. 生成 requestId = crypto.randomUUID()
3. POST /api/v3/albums { requestId, language, prompt?, photos[] }
   → 服务端:建 album(status=AGENT_RUNNING)+ 建 job + 按张实扣积分 hold + 派 /v3/analyze
   → 返回 { albumId, requestId }(派发失败也返回 albumId,前端打开可重试失败卡)
4. router.push(/album/${albumId})
5. Agent 后台跑 analyze,回推 POST /api/v3/internal/job-progress(progress/completed/failed);completed 只带 tree
6. Web 在 tree ready 后派 `/v3/select-layout`,Agent 回推同一个 job-progress sink;completed 带 pages
7. 浏览器轮询 GET /api/v1/albums/[uuid],按 album.status 驱动界面(见 §5)
```

约束(`POST /api/v3/albums` body,zod 校验):`photos.length ∈ [1, 100]`;每张 base64 ≤ 800KB;`prompt` ≤ 500 字;`takenAt` 是**唯一**允许的 EXIF 字段(§3 隐私,不收坐标)。

`retry`:`POST /api/v3/albums/[uuid]/retry`,复用 album 内的 prompt,浏览器从 IndexedDB 重传 base64;非 FAILED 态 → `ALBUM_NOT_RETRIABLE`(409)。

### 3.2 ②③④⑤ 编辑(同步)

进编辑器后用 `GET /api/v3/albums/[uuid]/draft` 拿预览骨架,然后按环节调同步端点(前端转圈,不轮询):

```
② 章节故事:POST /api/v3/albums/[uuid]/chapter-chat { chapterId, history, userMessage, focusedPageIndex?, language }
            完成一章 → POST /api/v3/albums/[uuid]/story-progress(markChapterDone)
③ 主题:    POST .../recommend → 用户选 → POST .../apply-theme
④ 封面:    POST .../cover(可跳过)
⑤ 待导出:  POST .../finalize → 拍平落 album_pages
```

数据归属红线:authoring 树(`draft_json`)**永不往返浏览器**。chapter-chat 浏览器只发 `chapterId` + history + message;Web service **server 侧**重切单章再转发无状态 Agent,patch 由 Web 写回 `draft_json` / 推进 `stage`。

### 3.3 PDF 导出

```
1. 浏览器用 @react-pdf/renderer 本地生成 PDF Blob
2. POST /api/v1/albums/[uuid]/pdf-upload-url { contentType, size } → { putUrl, r2Key, publicUrl }(size ≤ 50MB)
3. PUT putUrl(浏览器直传 R2)
4. PUT /api/v1/albums/[uuid]/pdf { r2Key } → 校验 r2Key 存在,album.status='COMPLETED'(不动积分)
5. 下载链接 = publicUrl
```

---

## 4. 单页编辑

`PATCH /api/v1/albums/[uuid]/pages/[idx]` 只改**单页**,不整体 PUT layout。body 至少含 `imagesJson` / `textsJson` / `imagePosJson` 之一:

```json
{ "textsJson": { "title": "新标题" } }
```

服务端:校验归属 → `albumPageRepo.update`。浏览器乐观更新本地 store,失败回滚。

---

## 5. 轮询(生成进度)

轮询对象是 `GET /api/v1/albums/[uuid]`(`useAlbumPoll`),**不是** job requestId。`album.status` 是单一真相源。

- 间隔固定(简单优先,不指数退避);终态立即停。
- **终止语义**:
  - `200 + AGENT_RUNNING` → 继续轮询
  - `200 + EDITING / COMPLETED` → 停,渲染编辑器
  - `200 + FAILED` → 停,显示 `album.errorMessage` + 重试 CTA
  - `401` → 跳 `/login?from=...`
  - `403 / 404` → 致命:停(别人的 / 已删)
  - `5xx / fetch 异常` → 有限重试后报错
- **服务端收尸双保险**:`GET /api/v1/albums/[uuid]` 读时机会式收尸(最新 job > 5 分钟无终态 → 标 FAILED + 退积分);`/api/v1/admin/recover-stuck` cron 兜底(`services/job/zombie-sweeper.ts`)。
- 都是普通 Route Handler,不用 SSE / WebSocket。

---

## 6. 限流(最简单版)

放 Vercel Edge Middleware:单用户短窗口内限 `POST /api/v3/albums`;单 IP 限任意 `/api/*`。可用 Upstash Ratelimit(免费额度够 1000 用户)。

---

## 7. 自查

- [ ] route.ts 行数 ≤ 40,只做 requireAuth → await params → parseBody → 调一次 service?
- [ ] 请求/响应字段是 camelCase(TS 层)?
- [ ] 业务逻辑全在 service,route 不 import drizzle / 外部 SDK?
- [ ] 错误用 `ERRORS.XXX()` 抛,catch 走 `fromException`?
- [ ] 改了 `/v3` 端点契约,有没有同步 `packages/contracts` + `docs/agent/contract.md`?
- [ ] `job-progress` callback 做了 Bearer 校验 + 幂等?
