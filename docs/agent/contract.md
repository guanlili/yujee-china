# Agent V3 对外契约

> **前置阅读**: `CLAUDE.md` -> `docs/architecture.md`
>
> 本文只定义 Web <-> Agent 的 HTTP 协议、req/res、错误码、状态机。Agent 内部 pipeline、模型 failover、prompt 分层、redact 规则见 [`docs/agent/design.md`](./design.md)。

---

## 1. Truth Source

V3 contract 的单一真相源是 `packages/contracts/src/v3.ts`、`packages/contracts/src/layout.ts`、`packages/contracts/src/enums.ts`。

- TypeScript zod schema 先行;Agent Python `apps/agent/src/schemas.py` 必须逐字段镜像。
- 所有 object schema 都是 strict;Python mirror 使用 `extra='forbid'`。未知字段必须拒绝,不能静默透传。
- 模板与扁平渲染结构由 `layout.ts` 和模板 loader 约束;Agent 不自由生成 contract 外字段。
- V3 authoring tree 只在交互期存在;只有 `/v3/finalize` 返回扁平 `AlbumLayoutPlan` 给渲染/PDF。

---

## 2. Auth & Envelope

所有 Agent 业务端点均只接受 Web server 调用。

请求头:

```http
Authorization: Bearer <AGENT_SHARED_SECRET>
Content-Type: application/json
X-Request-Id: <uuid>
```

成功 envelope:

```json
{ "ok": true, "data": {} }
```

失败 envelope:

```json
{ "ok": false, "error": { "code": "AGENT_INVALID_INPUT", "message": "..." } }
```

约定:

- Bearer 校验失败 -> HTTP 401 `AGENT_UNAUTHORIZED`。
- 请求体验证失败 -> HTTP 400 `AGENT_INVALID_INPUT`。
- Agent route 不返回裸对象;业务数据一律放在 `data`。
- `/v3/analyze` 与 `/v3/select-layout` 成功接单返回 HTTP 202。
- 同步端点成功返回 HTTP 200。
- 同步端点 output validation 类错误返回 HTTP 422 + `AGENT_OUTPUT_VALIDATION`;Web client 会映射成 Web 侧 `AGENT_INVALID_OUTPUT`。

---

## 3. Endpoint Map

### 3.1 Agent V3 endpoints

| Endpoint | Mode | Purpose |
|---|---|---|
| `GET /health` | sync | Agent health check |
| `POST /v3/analyze` | async, HTTP 202 + callback | Stage1: 接收 base64 照片,生成 tree-only `V3LayoutTree` |
| `POST /v3/select-layout` | async, HTTP 202 + callback | Stage2: 接收 browser 200px refs,生成 `Page[]` |
| `POST /v3/chapter-chat` | sync | 无状态单章引导、写作、改页 turn |
| `POST /v3/edit-chat` | sync + Agent DB | 当前主编辑 turn: pending op + Web ack |
| `POST /v3/page-edit` | sync | 聚焦页两段式编辑 helper |
| `POST /v3/recommend` | sync | 推荐 3 组 book theme options |
| `POST /v3/apply-theme` | sync deterministic | 应用用户选择的主题、章节色、字体 |
| `POST /v3/cover` | sync awaited async | 生成或跳过封面/封尾补丁 |
| `POST /v3/finalize` | sync deterministic | 将整棵树 + pages 拍平成 `AlbumLayoutPlan` |
| `POST /internal/agent-ack` | sync + Agent DB | Web 确认 edit op 已落库后,Agent 提交 pending op/messages |

### 3.2 Web orchestration routes

| Web route | Purpose |
|---|---|
| `POST /api/v3/albums` | 创建相册、扣费 hold、派发 `/v3/analyze` |
| `POST /api/v3/internal/job-progress` | Agent analyze/select-layout callback sink |
| `POST /api/v3/albums/:id/select-layout` | 浏览器补 200px refs 后派发 `/v3/select-layout` |
| `POST /api/v3/albums/:id/retry` | 对失败相册重新派发 init |
| `GET /api/v3/albums/:id/draft` | 读取 tree + pages draft |
| `GET/POST /api/v3/albums/:id/story-progress` | 读取/推进章节完成度 |
| `POST /api/v3/albums/:id/edit-chat` | 代理当前主编辑 turn |
| `POST /api/v3/albums/:id/chapter-chat` | 代理 legacy/stateless 单章 turn |
| `POST /api/v3/albums/:id/recommend` | 代理推荐主题与章节色 |
| `POST /api/v3/albums/:id/apply-theme` | 代理并持久化主题应用 |
| `POST /api/v3/albums/:id/cover` | 代理并持久化封面/封尾应用 |
| `POST /api/v3/albums/:id/finalize` | 代理 finalize 并返回扁平定稿 |
| `POST /api/v3/internal/agent-data` | Agent edit-chat 读取 Web-owned draft context |

---

## 4. Shared Shapes

### 4.1 `V3Usage`

```ts
{
  durationMs: number;
  visionCallCount: number;
  geminiCallCount: number;
  planningInputTokens: number;
  planningOutputTokens: number;
  repairAttempts: number;
  models: { vision?: string; planning?: string };
}
```

### 4.2 Authoring tree

`V3LayoutTree`:

```ts
{ chapters: V3Chapter[] }
```

`V3Chapter`:

```ts
{
  chapterId: string;
  description: string; // 目录(TOC)占位:分析期留空(""),后期写目录环节才填;不进下游 AI 上下文
  extractedColor?: string | null;
  accentColor: string | null;
  artFont: "serif-classic" | "sans-modern" | "script-elegant" | "display-bold" | null;
  photos: V3ChapterPhoto[];
}
```

`V3ChapterPhoto`:

```ts
{
  photoId: string;
  sceneDescription: string;
  width: number;
  height: number;
  orientation: "portrait" | "landscape" | "square";
  takenAt?: string | null;
}
```

### 4.3 Page and patch

`Page` is the render page shape from `layout.ts`:

```ts
{
  pageIndex: number;
  templateId: string;
  images: Record<string, string>;
  texts: Record<string, string>;
  imagePos?: Record<string, { x: number; y: number; scale: number }>;
}
```

`V3LayoutPatchEntry`:

```ts
{
  pageIndex: number;
  templateId?: string;
  images?: Record<string, string>;
  texts?: Record<string, string>;
}
```

`V3PageTextsPatch`:

```ts
{ pageIndex: number; texts: Record<string, string> }
```

---

## 5. Async Init Jobs

### 5.1 `POST /v3/analyze`

唯一带原图 base64 的 Agent endpoint。Agent 接单后立即返回 202,后台执行 Stage1,终态只通过 callback 通知 Web。

Request:

```ts
{
  requestId: string;
  albumId: string;
  callbackUrl: string;
  language: "zh" | "en";
  meta?: { promptHint?: string };
  photos: Array<{
    photoId: string;
    base64: string;
    width: number;
    height: number;
    clusterId?: string | null;
    exif?: { takenAt?: string | null };
  }>;
}
```

Accepted response:

```json
{ "ok": true, "data": { "requestId": "req_xxx", "accepted": true } }
```

Stage1 completed callback:

```ts
{
  requestId: string;
  jobKind: "analyze";
  event: "completed";
  tree: V3LayoutTree;
  usage: V3Usage;
}
```

Important: analyze completed is tree-only. It must not include `pages`.

### 5.2 `POST /v3/select-layout`

Stage2 consumes the Stage1 tree slice plus browser-held 200px refs. It returns pages through the same callback sink and usually reuses the analyze/init `requestId`.

Request:

```ts
{
  requestId: string;
  callbackUrl: string;
  language: "zh" | "en";
  chapters: Array<{
    chapterId: string;
    structureHint?: string;
    photos: Array<{
      photoId: string;
      ref200px: string;
      orientation: "portrait" | "landscape" | "square";
      takenAt: string | null;
    }>;
  }>;
}
```

Completed callback:

```ts
{
  requestId: string;
  jobKind: "select-layout";
  event: "completed";
  pages: Page[];
  usage: V3Usage;
}
```

### 5.3 Shared progress and failure callbacks

Progress callback:

```ts
{
  requestId: string;
  jobKind: "analyze" | "select-layout";
  event: "progress";
  stage: "describe" | "group" | "template" | "preview" | "layout" | "legalize" | "wrap";
  progress: number;
  message?: string;
}
```

Failed callback:

```ts
{
  requestId: string;
  jobKind: "analyze" | "select-layout";
  event: "failed";
  error: { code: string; message: string };
  stage?: "describe" | "group" | "template" | "preview" | "layout" | "legalize" | "wrap";
  progress?: number;
}
```

Web handling:

- analyze completed stores the tree draft and keeps init job/credit hold open.
- select-layout completed merges pages, sets job completed, sets album `status=EDITING`, advances `stage=story`, and settles the hold.
- failed maps the Agent error code, marks job/album failed, and releases the credit hold.

---

## 6. Sync Endpoints

All sync endpoints return:

```ts
{ ok: true; data: <EndpointResponse> }
```

### 6.1 `POST /v3/chapter-chat`

Stateless single-chapter turn. Web sends one chapter and its pages.

```ts
{
  albumId: string;
  language: "zh" | "en";
  chapter: V3Chapter;
  pages: Page[];
  history: Array<{ role: "user" | "assistant"; content: string }>;
  userMessage: string;
  focusedPageIndex?: number;
}
```

Response:

```ts
{
  kind: "talk" | "write" | "edit";
  assistantReply: string;
  pagesTexts?: V3PageTextsPatch[];
  layoutPatch?: V3LayoutPatchEntry[];
  nameOptions?: string[];
  usage: V3Usage;
}
```

### 6.2 `POST /v3/edit-chat`

Current stateful authoring turn. Agent owns pending edit op state in `agent.*`; Web owns album draft and must ack after committing.

Request:

```ts
{
  albumId: string;
  language: "zh" | "en";
  userMessage: string;
  focus: { chapterId?: string; pageIndex?: number };
  progress: { currentChapterId: string | null; doneChapterIds: string[] };
}
```

Response:

```ts
{
  kind: "talk" | "write" | "edit";
  assistantReply: string;
  patches: V3LayoutPatchEntry[];
  pagesTexts?: V3PageTextsPatch[] | null;
  progressDecision?: { pageDone?: boolean; chapterDone?: boolean; advanceTo?: "theme" } | null;
  opId: string;
  usage: V3Usage;
}
```

Rules:

- Agent serializes turns per album/chapter through `agent.edit_sessions`.
- Agent writes pending `agent.edit_ops` and pending `agent.edit_messages`.
- Web must call `/internal/agent-ack` after its album transaction commits.
- Missing `DATABASE_URL` is an infrastructure failure.

### 6.3 `POST /v3/page-edit`

Focused-page helper. It is intentionally conservative: model/key/parse failures degrade to `talk` with no patch.

Request:

```ts
{
  language: "zh" | "en";
  chapter: V3Chapter;
  pages: Page[];
  focusedPageIndex: number;
  userMessage: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
}
```

Response:

```ts
{
  assistantReply: string;
  intent: "edit_text" | "change_layout" | "advance" | "talk";
  layoutPatch?: V3LayoutPatchEntry[];
  advanceIntent?: true;
  usage: V3Usage;
}
```

### 6.4 `POST /v3/recommend`

Request:

```ts
{
  albumId: string;
  language: "zh" | "en";
  chapters: Array<{
    chapterId: string;
    description: string; // 目录占位,分析期为空("");recommend 不再喂给模型,仅保留契约字段
    extractedColor?: string | null;
    photoDescs: string[];
  }>;
  analysisSummary?: string | null;
  userMessage?: string | null;
  fontHint?: string | null;
}
```

Response:

```ts
{
  bookThemeOptions: Array<{
    optionId: string;
    artFont: "serif-classic" | "sans-modern" | "script-elegant" | "display-bold";
    label?: string;
    style?: string;
    chapters: Array<{
      chapterId: string;
      subject?: string;
      accentColor: string;
    }>;
  }>;
  assistantReply: string;
  usage: V3Usage;
}
```

Rules:

- `bookThemeOptions.length === 3`.
- Each option must cover every requested chapter exactly once.
- No `templateId`, `pageIndex`, or layout instructions are allowed in the response contract.

### 6.5 `POST /v3/apply-theme`

Pure deterministic transform.

```ts
{
  albumId: string;
  language: "zh" | "en";
  chapters: Array<{
    chapterId: string;
    subject?: string;
    accentColor: string;
    artFont: "serif-classic" | "sans-modern" | "script-elegant" | "display-bold";
  }>;
  pages: Page[];
}
```

Response:

```ts
{ layoutPatch: V3LayoutPatchEntry[]; assistantReply?: string; usage: V3Usage }
```

Rules:

- No model call.
- `layoutPatch.length >= 1` on success.
- Multi-chapter choices plus pages are rejected because pages carry no `chapterId`.
- Empty title slots may receive `subject`; non-empty user titles are preserved.
- SVG variableDecor slots receive `accentColor`; normal prose is not rewritten.

### 6.6 `POST /v3/cover`

Optional cover/ending stage. Skipping both is valid.

```ts
{
  albumId: string;
  language: "zh" | "en";
  coverTemplateId?: string | null;
  endingTemplateId?: string | null;
  coverPhoto?: string;
  endingPhoto?: string;
  coverPhotoDesc?: string;
  artFont?: "serif-classic" | "sans-modern" | "script-elegant" | "display-bold";
  hint?: string;
  userMessage?: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  pages: Page[];
}
```

Response:

```ts
{
  layoutPatch: V3LayoutPatchEntry[];
  assistantReply?: string;
  needsUserInput: boolean;
  usage: V3Usage;
}
```

Rules:

- `coverTemplateId` and `endingTemplateId` are optional independently.
- Skipping both returns an empty `layoutPatch`.
- Stage5 optional string/base64 fields should be omitted when absent; explicit null is rejected for `coverPhoto`, `endingPhoto`, `coverPhotoDesc`, `artFont`, and `hint`.

### 6.7 `POST /v3/finalize`

```ts
{
  albumId: string;
  language: "zh" | "en";
  tree: V3LayoutTree;
  pages: Page[];
}
```

Response:

```ts
{ layout: AlbumLayoutPlan; usage: V3Usage }
```

Rules:

- This is the only sync endpoint that receives the complete authoring tree.
- It bakes chapter color/font carriers into flat `pages[].texts`.
- Response `layout` must not contain tree-shaped fields.
- V3 does not require page 0 to be a cover.

### 6.8 `POST /internal/agent-ack`

```ts
{ opId: string }
```

Response:

```ts
{ ok: boolean }
```

Rules:

- `ok=true`: pending op/messages were committed.
- `ok=false`: op not found or not pending.
- Missing/unavailable Agent DB returns HTTP 503 `AGENT_DB_UNAVAILABLE`.

---

## 7. State Machine

`albums.stage` is the V3 user-flow state and is owned by Web:

```ts
"analysing" | "story" | "theme" | "cover" | "ready"
```

Stage transitions:

| From | To | Owner | Trigger |
|---|---|---|---|
| `analysing` | `story` | Web | select-layout completed callback after analyze tree is ready |
| `story` | `theme` | Web | every chapter marked done through edit progress |
| `theme` | `cover` | Web | apply-theme accepted and merged |
| `theme` | `ready` | Web | cover step skipped from theme |
| `cover` | `ready` | Web | cover/ending accepted or skipped |

`albums.status` is orthogonal:

```ts
"AGENT_RUNNING" | "EDITING" | "COMPLETED" | "FAILED"
```

`agent_jobs.status` tracks async init jobs:

```ts
"QUEUED" | "RUNNING" | "COMPLETED" | "FAILED"
```

---

## 8. Error Codes

| Code | Source | Surface |
|---|---|---|
| `AGENT_INVALID_INPUT` | strict request validation | HTTP 400 |
| `AGENT_UNAUTHORIZED` | missing/invalid bearer | HTTP 401 |
| `AGENT_VISION_FAILED` | recognition model, parse, or describe failure | analyze failed callback |
| `AGENT_PLANNING_FAILED` | text/planning model failure | HTTP 502 |
| `AGENT_OUTPUT_VALIDATION` | Agent produced invalid patch/layout | HTTP 422 or async failed callback |
| `AGENT_TIMEOUT` | background async job exceeded budget | async failed callback |
| `AGENT_DB_UNAVAILABLE` | Agent-owned DB missing/unavailable | HTTP 503 |
| `AGENT_INTERNAL_ERROR` | unknown exception | HTTP 500 or async failed callback |

Web mapping:

- Agent `AGENT_OUTPUT_VALIDATION` is persisted/exposed by Web as `AGENT_INVALID_OUTPUT`.
- Unknown Agent codes are not swallowed; Web keeps the code string for diagnostics.

---

## 9. Privacy Boundary

- Base64 appears only in `/v3/analyze` request memory.
- `/v3/select-layout` receives browser-derived 200px refs, not original images.
- `/v3/cover` may receive bounded thumbnails for local color extraction; those are not prompt payload.
- `exif` only allows `takenAt`.
- `clusterId` is an opaque same-place/same-time label, never a coordinate.
- No coordinate, GPS, `place`, or `location` field is allowed in analyze request, tree, callbacks, or sync endpoint responses.
- Redact keys are defensive guardrails; seeing one in a log payload is a bug to scrub, not a contract field to preserve.
