# Web API 接口清单与浏览器流程

> **前置阅读**: `CLAUDE.md` → `docs/architecture.md` → `docs/web/layering.md`
>
> 谁读这份: 写 `app/api/*` 的 route.ts,或写 UI 时需要调接口的人。

---

## 1. 接口清单

| Method | Path | 鉴权 | 说明 |
|---|---|---|---|
| POST   | `/api/v1/jobs` | user | 提交 prompt + base64,触发生成,立刻返回 requestId |
| GET    | `/api/v1/jobs/[requestId]` | user | 轮询任务状态(stage / progress / status) |
| GET    | `/api/v1/albums` | user | 我的相册列表 |
| GET    | `/api/v1/albums/[uuid]` | user | 单个相册详情(含所有页)|
| PATCH  | `/api/v1/albums/[uuid]` | user | 改标题等基础字段 |
| DELETE | `/api/v1/albums/[uuid]` | user | 删除相册 |
| PATCH  | `/api/v1/albums/[uuid]/pages/[idx]` | user | 编辑器保存单页 |
| POST   | `/api/v1/albums/[uuid]/chat` | user | Chat 编辑(同步,Web 转 Agent /v1/chat-edit) |
| GET    | `/api/v1/albums/[uuid]/messages` | user | 拉对话历史 |
| POST   | `/api/v1/albums/[uuid]/pdf-upload-url` | user | 签 R2 PUT URL |
| PUT    | `/api/v1/albums/[uuid]/pdf` | user | 上传完成后通知服务端 |
| GET    | `/api/v1/albums/[uuid]/pdf` | user | 拿当前 PDF 下载 URL |
| GET    | `/api/v1/credit/balance` | user | 当前积分 |
| GET    | `/api/v1/credit/history` | user | 积分流水 |
| POST   | `/api/v1/internal/job-progress` | agent | Agent 进度回调 |
| GET    | `/api/v1/health` | none | 健康检查 |
| POST   | `/api/webhooks/stripe` | sig | Stripe 回调 |
| POST   | `/api/webhooks/creem` | sig | Creem 回调 |

---

## 2. 统一响应

成功:
```json
{ "ok": true, "data": { ... } }
```

失败:
```json
{ "ok": false, "error": { "code": "CREDIT_INSUFFICIENT", "message": "..." } }
```

错误码完整表 → `docs/web/errors.md §2`。

---

## 3. 关键接口详细

### 3.1 `POST /api/v1/jobs`

请求:
```json
{
  "requestId": "req_xxx",
  "prompt": "我和妈妈在京都的春天",
  "language": "zh",
  "photos": [
    {
      "photoId": "p1",
      "base64": "data:image/jpeg;base64,/9j/4AAQ...",
      "width": 800,
      "height": 600
    }
  ]
}
```

约束:
- `requestId` 由**浏览器生成**(UUID v4),用于轮询 key 和全链路追踪。服务端校验格式后透传给 Agent。
- `photos.length` ∈ [3, 30]
- 每张 base64 ≤ 800KB
- `prompt` ≤ 500 字

服务端流程(**fire-and-forget**,不阻塞,详见 `docs/agent/contract.md §2.1`):

1. `requireAuth`
2. `parseBody`(zod 校验上面约束)
3. `creditService.precheck(userId, cost)`,不足 → `CREDIT_INSUFFICIENT`
4. 事务里:
   - `albumService.create({ userId, status: 'AGENT_RUNNING', prompt, photoCount })` → 拿 `albumId`
   - `jobService.create({ albumId, userId, requestId, status: 'QUEUED' })`
5. `agentClient.submitLayout(...)`,Agent 5 秒内 202 接单(不等结果)
6. 把 `agent_jobs.status` 标 `RUNNING`,返回 `{ albumId, requestId }` 给浏览器
7. **本次 HTTP 请求到此结束**。Web 函数在 ≤ 8 秒内退出。终态由 Agent 后续 callback 写入,见 §3.3。

> **关键约定**:
> - 终态(completed / failed)由 **Agent callback** 写入 — 见 §3.3。
> - route.ts 仍 ≤ 40 行: 步骤 3-6 全部抽到 `generationService.submit(userId, input)`,route 只调一次 service。
> - **浏览器侧**:POST 拿到 `requestId` 后立刻 `router.push(/album/${albumId})`,在那个页面里开始 2 秒一次轮询 `GET /api/v1/jobs/[requestId]`。
> - **Vercel 函数超时**:不再是问题。函数执行 < 10 秒,Hobby/Pro 套餐都够。

响应(步骤 6):
```json
{ "ok": true, "data": { "albumId": "alb_xxx", "requestId": "req_xxx" } }
```

### 3.2 `GET /api/v1/jobs/[requestId]` (轮询)

浏览器每 2 秒拉一次,直到拿到终态。

响应:
```json
{
  "ok": true,
  "data": {
    "requestId": "req_xxx",
    "albumId": "alb_xxx",
    "status": "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED",
    "stage": "vision" | "writing" | "composing" | null,
    "progress": 0-100,
    "error": { "code": "...", "message": "..." } | null
  }
}
```

实现要点:
- 仅 `jobRepo.findByRequestId(requestId)` 一次,无副作用。
- `requireAuth` 后**校验归属**:`job.userId === user.id`,否则 403。
- 浏览器在 `status` ∈ `{COMPLETED, FAILED}` 时停止轮询;前者跳编辑页,后者展示错误。
- **不**做 long-poll。这是个纯 GET,完全无状态,Vercel 上必然工作。

### 3.3 `POST /api/v1/internal/job-progress`

**只能被 Agent 调用**。接收 progress / completed / failed 三类事件。

Header: `Authorization: Bearer ${AGENT_SHARED_SECRET}`

请求体(统一信封,见 `docs/agent/contract.md §2.1`):
```json
{
  "requestId": "req_xxx",
  "event": "progress" | "completed" | "failed",
  "stage": "vision" | "writing" | "composing",
  "progress": 30,
  "message": "...",
  "layout": { ... },
  "error": { "code": "...", "message": "..." },
  "usage": { "visionTokens": ..., "planningTokens": ..., "durationMs": ... }
}
```

服务端流程:
1. 校验 Bearer,失败 → 401 `AGENT_UNAUTHORIZED`
2. zod 校验 envelope
3. `jobRepo.findByRequestId(requestId)` — 找不到 → 404
4. **幂等检查**:若 `agent_jobs.status` 已是 `COMPLETED`/`FAILED`,直接返回 `{ ok: true }`(忽略重复 callback)
5. 按 `event` 分发(全部走 `jobService`):
   - `progress`:更新 `agent_jobs.stage` / `progress` / `updated_at`
   - `completed`:事务里 ——
     - zod 校验 `layout`(`AlbumLayoutPlan`)
     - `albumRepo.update(albumId, { layoutJson, title, status: 'EDITING' })`
     - `albumPageRepo.bulkInsert(albumId, layout.pages)`
     - `creditService.hold(tx, userId, albumId, cost)`
     - `jobRepo.update(jobId, { status: 'COMPLETED', usage, completedAt: now })`
   - `failed`:事务里 ——
     - `albumRepo.update(albumId, { status: 'FAILED', errorMessage: error.message })`
     - `creditService.release(tx, userId, albumId)`
     - `jobRepo.update(jobId, { status: 'FAILED', error, completedAt: now })`
6. 返回 `{ ok: true }`

> 浏览器**不**直接收这个 callback,而是靠下次轮询拿到 `status` 变更。

完整 Agent 协议 → `docs/agent/contract.md`。

### 3.4 `GET /api/v1/albums/[uuid]`

服务端:
1. `requireAuth`
2. `albumService.findOwned(user.id, uuid)` → 自动校验归属
3. 查 `album_pages`(按 `page_index asc`)
4. 返回:

```json
{
  "ok": true,
  "data": {
    "album": { "id": "...", "title": "...", "status": "EDITING", "layoutJson": {...} },
    "pages": [ { "pageIndex": 0, "templateId": "cover-01", "imagesJson": {...}, "textsJson": {...} } ]
  }
}
```

### 3.5 `PATCH /api/v1/albums/[uuid]/pages/[idx]`

编辑器只 PATCH **单页**,不整体 PUT layout_json。

请求:
```json
{ "textsJson": { "title": "新标题" } }
```
或:
```json
{ "imagesJson": { "hero": "p2" } }
```

服务端:
1. 校验归属
2. `albumPageRepo.update(tx, ...)`

### 3.5a `POST /api/v1/albums/[uuid]/chat`

Chat 编辑入口。**同步**:用户在 chat 框里等 AI 回复,不轮询。

请求:
```json
{
  "message": "把第二页副标题改得更感性一些",
  "language": "zh"
}
```

约束:
- `message` ≤ 500 字
- 同一相册并发 chat → 后到的 409 `CHAT_BUSY`(防止 patch 互相覆盖)

服务端流程(`route.ts` ≤ 40 行,业务全在 `chatService`):

1. `requireAuth`
2. `albumService.findOwned(user.id, uuid)` —— 校验归属;`album.status === 'EDITING'` 才允许 chat,否则 409
3. **不**再 precheck 积分(生成时一次 hold 已包编辑期)
4. `albumMessageRepo.findRecent(albumId, limit=20)` —— 拉最近对话
5. `chatService.edit(user.id, albumId, message)`,内部:
   - 拼 Agent 入参:`{ albumId, currentLayout: albums.layout_json, history, userMessage: message, language }`
   - 调 `agentClient.chatEdit(payload)`(60s 超时,见 `docs/agent/contract.md §2.3`)
   - 事务里:
     - `albumMessageRepo.insert({ role: 'user', content: message })`
     - 把 `layoutPatch` apply 到 `album_pages`(只 PATCH 受影响的行)
     - 把 patch 写回 `albums.layout_json`
     - `albumMessageRepo.insert({ role: 'assistant', content: assistantReply, layoutPatch, usage })`
6. 返回:

```json
{
  "ok": true,
  "data": {
    "assistantReply": "已经把第二页副标题改成「春天总是来得太早」。",
    "layoutPatch": [
      { "pageIndex": 1, "textsJson": { "subtitle": "春天总是来得太早" } }
    ],
    "messageId": "msg_xxx"
  }
}
```

> 浏览器拿到 `layoutPatch` 后**就地更新本地 store**,不需要刷整本 album。

错误码:
- `CHAT_BUSY`(409)—— 同 album 还有在跑的 chat
- `AGENT_CHAT_FAILED`(502)—— Agent 调 DeepSeek 失败 / repair 失败
- `ALBUM_NOT_EDITABLE`(409)—— album.status 不是 EDITING

### 3.5b `GET /api/v1/albums/[uuid]/messages`

拉对话历史,供编辑器 chat 面板渲染。

Query: `?limit=50&before=msg_xxx`(分页,默认 50,按 `created_at desc`)

响应:
```json
{
  "ok": true,
  "data": {
    "messages": [
      { "id": "msg_001", "role": "user", "content": "...", "createdAt": "..." },
      { "id": "msg_002", "role": "assistant", "content": "...", "layoutPatch": [...], "createdAt": "..." }
    ]
  }
}
```

实现要点:
- 校验归属
- 仅查不写

### 3.6 `POST /api/v1/albums/[uuid]/pdf-upload-url`

签一个 R2 presigned PUT URL,浏览器拿来直传。

请求:
```json
{ "contentType": "application/pdf", "size": 4500000 }
```

约束:
- size ≤ 50MB
- 5 分钟过期

响应:
```json
{
  "ok": true,
  "data": {
    "putUrl": "https://r2.../pdfs/u123/alb_xxx.pdf?X-Amz-...",
    "r2Key": "pdfs/u123/alb_xxx.pdf",
    "publicUrl": "https://cdn.yujeeai.com/pdfs/u123/alb_xxx.pdf"
  }
}
```

### 3.7 `PUT /api/v1/albums/[uuid]/pdf`

浏览器上传完后调,通知服务端。

请求:
```json
{ "r2Key": "pdfs/u123/alb_xxx.pdf" }
```

服务端:
1. 校验归属
2. 校验 r2Key 是否真的存在(HEAD 一次 R2)
3. 事务: `albums.pdf_r2_key` 写入 + `status='COMPLETED'` + `creditService.settle`

---

## 4. 浏览器侧三个核心流程

### 4.1 生成流程

```
1. 用户在 /create 选 3-30 张照片
   → photosStore.add(File)

2. 浏览器压缩 → base64
   → lib/photo/compress.ts: Canvas 缩到 800px, quality 0.6
   → photosStore.setBase64(photoId, base64)

3. 点"开始制作":
   3a. 浏览器先生成 requestId = crypto.randomUUID()
   3b. POST /api/v1/jobs { requestId, prompt, language, photos }
       → 这个请求在 5-10 秒内返回 { albumId, requestId }
       → Agent 已经在后台开始跑了

4. POST 响应回来:
   → router.push(`/album/${albumId}?job=${requestId}`)

5. 编辑页 mount:
   5a. useJobPoll(requestId) — 每 2 秒 GET /api/v1/jobs/[requestId]
       → 拿 stage / progress,渲染"AI 在看图/写文/排版"
       → status === 'COMPLETED' → 停轮询,刷新 album
       → status === 'FAILED' → 停轮询,显示错误 + 重试 CTA
   5b. status === COMPLETED 后 GET /api/v1/albums/[uuid] 拿 layout + pages 渲染
```

> 浏览器**不**开 SSE/WebSocket。轮询接口完全无状态,可以无限重试,断网恢复也自动续上。1000 用户阶段最坏情况:1000 人同时生成 → 500 QPS 轮询,Vercel + Neon 都扛得住。

### 4.2 编辑流程

编辑分两种入口:**直接 PATCH**(精确改) vs **Chat 对话**(自然语言改)。

```
1. 编辑页加载
   → GET /api/v1/albums/[uuid]
   → GET /api/v1/albums/[uuid]/messages (拉对话历史,渲染 chat 面板)
   → 拿到 layoutJson + pages + messages[]

2. 从 IndexedDB 按 photoId 加载原图 blob URL
   → photosStore 提供 blob URL 缓存

3a. 用户直接改文案(双击就地编辑)
    → PATCH /api/v1/albums/[uuid]/pages/0 { textsJson: { title: "新" } }
    → 乐观更新本地 store,失败回滚

3b. 用户拖图换位置
    → PATCH /api/v1/albums/[uuid]/pages/0 { imagesJson: { hero: "p3" } }

4. 用户在 Chat 面板里说"把第二页副标题改感性点"
   → POST /api/v1/albums/[uuid]/chat { message }
   → 等(loading)~5-20s
   → 拿到 { assistantReply, layoutPatch }
   → 本地按 patch 就地更新 album_pages store(不需要刷全 album)
   → chat 面板追加 user + assistant 两条
```

> 编辑期间(`album.status === 'EDITING'`)**不再扣积分**,生成时那一笔 hold 包了。

### 4.3 PDF 导出

```
1. 用户点"导出 PDF"

2. 浏览器组合 layoutJson + 原图,用 @react-pdf/renderer 生成 Blob
   → lib/pdf/render.ts

3. POST /api/v1/albums/[uuid]/pdf-upload-url { contentType, size }
   → 拿到 { putUrl, r2Key, publicUrl }

4. PUT putUrl  (浏览器直接 PUT Blob 到 R2)
   Content-Type: application/pdf
   Body: Blob

5. PUT /api/v1/albums/[uuid]/pdf { r2Key }
   → 服务器结算积分,album.status='COMPLETED'

6. 显示下载链接 = publicUrl
```

---

## 5. 轮询实现注意点

- 间隔:固定 2 秒(`setInterval(2000)`)。不做指数退避——简单优先。
- 终态条件:`status` ∈ `{COMPLETED, FAILED}` 时 `clearInterval` 并卸载 hook。
- 兜底超时:浏览器侧 3 分钟还没拿到终态 → 主动停止 + 显示"任务可能失败,请刷新查看"。
- **服务端 zombie sweeper(第一版做)**:`apps/web/src/lib/zombie-sweeper.ts`,启动时 setInterval(60s) 扫 `agent_jobs.status='RUNNING' AND created_at < now()-5min` → 标 FAILED + 释放积分。挂在 `instrumentation.ts`。完整设计见 [`docs/agent/design.md §7`](../agent/design.md)。
- **不**用 Node runtime 的任何流式特性;`GET /api/v1/jobs/[requestId]` 是普通 Route Handler。

---

## 6. 限流(第一版只做最简单的)

放在 Vercel Edge Middleware 里:
- 单用户 60 秒内最多 5 次 `POST /api/v1/jobs`
- 单 IP 1 分钟内最多 60 次任意 `/api/v1/*`

实现可以用 Upstash Ratelimit(免费额度够 1000 用户)。

---

## 7. 自查

- [ ] 我的 route.ts 行数 ≤ 40?
- [ ] 我的请求/响应字段是 camelCase(TS 层)?
- [ ] 我把业务逻辑全放进 service 了吗?
- [ ] 错误是用 `ERRORS.XXX()` 抛的吗?
- [ ] `POST /jobs` 是 fire-and-forget,函数执行 < 10 秒?
- [ ] `job-progress` callback 做了幂等检查?
- [ ] 修改了接口,有没有同步 `packages/contracts`?
