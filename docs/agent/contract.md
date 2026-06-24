# Agent V3 对外契约

> **前置阅读**: `CLAUDE.md` -> `docs/architecture.md`
>
> 谁读这份: 写 Agent 接入层(Web 侧)或 Agent 路由的人。
>
> 本文只定义 Web <-> Agent 的 HTTP 协议、req/res、错误码、状态机。Agent 内部 pipeline、模型 failover、prompt skill、redact 规则见 [`docs/agent/design.md`](./design.md)。

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

- Bearer 校验失败 -> `AGENT_UNAUTHORIZED`。
- 请求体验证失败 -> `AGENT_INVALID_INPUT`。
- Agent route 不返回裸对象;业务数据一律放在 `data`。
- `/v3/analyze` 成功接单返回 HTTP 202;同步端点成功返回 HTTP 200。
- 同步端点的 output validation 类错误返回 HTTP 422 + `AGENT_OUTPUT_VALIDATION`;Web client 会映射成 Web 侧 `AGENT_INVALID_OUTPUT`。

---

## 3. Endpoint Map

### 3.1 Agent V3 endpoints

| Endpoint | Mode | Purpose |
|---|---|---|
| `POST /v3/analyze` | async, HTTP 202 + callback | 接收照片,生成章节树与预览页 |
| `POST /v3/chapter-chat` | sync | 单章引导、写作、改页 turn |
| `POST /v3/recommend` | sync | 推荐全局主题与每章色/字体 |
| `POST /v3/apply-theme` | sync deterministic | 应用用户选择的主题、章节色、字体 |
| `POST /v3/cover` | sync deterministic | 生成或跳过封面/封尾补丁 |
| `POST /v3/finalize` | sync deterministic | 将整棵树拍平成 `AlbumLayoutPlan` |

### 3.2 Web orchestration routes

| Web route | Purpose |
|---|---|
| `POST /api/v3/albums` | 创建相册、扣费 hold、派发 `/v3/analyze` |
| `POST /api/v3/internal/job-progress` | Agent analyze callback sink |
| `POST /api/v3/albums/:id/retry` | 对失败相册重新派发 analyze |
| `GET /api/v3/albums/:id/draft` | 读取预览骨架 |
| `GET/POST /api/v3/albums/:id/story-progress` | 读取/推进章节完成度 |
| `POST /api/v3/albums/:id/chapter-chat` | 代理单章引导、写作、改页 turn |
| `POST /api/v3/albums/:id/recommend` | 代理推荐主题与章节色 |
| `POST /api/v3/albums/:id/apply-theme` | 代理并持久化主题应用 |
| `POST /api/v3/albums/:id/cover` | 代理并持久化封面/封尾应用 |
| `POST /api/v3/albums/:id/finalize` | 代理 finalize 并返回扁平定稿 |

---

## 4. Shared Shapes

### 4.1 `V3Usage`

```ts
{
  durationMs: number;
  visionCallCount: number;
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
  description: string;
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

## 5. `POST /v3/analyze`

唯一带 base64 的 Agent endpoint。Agent 接单后立即返回 202,后台执行,终态只通过 callback 通知 Web。

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

Constraints:

- `photos.length` is 1..30.
- `base64` must be `data:image/jpeg;base64,...` or `data:image/png;base64,...`, decoded size <= 800KB.
- `callbackUrl` must be HTTP(S).
- `language` is `zh` or `en`.
- `meta.promptHint` length <= 500.
- `clusterId` (#232) is an **opaque** co-location/co-time label (`c1`/`c2`/…) the browser derives locally from EXIF time/GPS. It is **never a coordinate** — it only says "these photos are same-place/same-time". Optional/nullable: when the browser can't derive it (no EXIF / no GPS) it is `null` or absent, and the Agent degrades to its current "one big batch / model groups freely" behavior (backward compatible). Empty string is rejected (`min(1)`).
- Photo object allows only `photoId`, `base64`, `width`, `height`, `clusterId`, and `exif.takenAt`.
- There is no coordinate, GPS, `place`, or `location` field. Any such field is rejected by strict schema. `clusterId` does **not** relax this — coordinate keys stay rejected even when a `clusterId` is present.

Accepted response:

```json
{
  "ok": true,
  "data": { "requestId": "req_xxx", "accepted": true }
}
```

---

## 6. Analyze Callback

Agent posts every analyze progress and terminal event to:

```http
POST /api/v3/internal/job-progress
Authorization: Bearer <AGENT_SHARED_SECRET>
Content-Type: application/json
```

`jobKind` is always `"analyze"`.

Progress event:

```ts
{
  requestId: string;
  jobKind: "analyze";
  event: "progress";
  stage: "describe" | "group" | "template" | "preview";
  progress: number;
  message?: string;
}
```

Completed event:

```ts
{
  requestId: string;
  jobKind: "analyze";
  event: "completed";
  tree: V3LayoutTree;
  pages: Page[];
  usage: V3Usage;
}
```

Failed event:

```ts
{
  requestId: string;
  jobKind: "analyze";
  event: "failed";
  error: { code: string; message: string };
  stage?: "describe" | "group" | "template" | "preview";
  progress?: number;
}
```

Progress semantics:

- `describe`: recognition model creates chapter grouping, chapter descriptions, and per-photo scene descriptions. When photos carry `clusterId` (#232), `describe` becomes **cluster-aware** and may run **concurrently** across clusters (见 `design.md`);when `clusterId` is absent it degrades to the current single-batch behavior.
- `group`: UI progress beat; grouping already happens inside `describe`.
- `template`: legal candidate selection and deterministic fallback.
- `preview`: preview tree/pages are ready.

Web handling:

- `progress` updates `agent_jobs.stage/progress` and transitions job to `RUNNING`.
- `completed` stores `tree + pages`, sets `agent_jobs.status=COMPLETED`, sets `albums.status=EDITING`, and advances `albums.stage=story`.
- `failed` maps the Agent error code, sets `agent_jobs.status=FAILED`, sets album `status=FAILED`, and releases the credit hold.

---

## 7. Sync Endpoints

All sync endpoints return:

```ts
{ ok: true; data: <EndpointResponse> }
```

### 7.1 `POST /v3/chapter-chat`

Request `V3ChapterChatRequest`:

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

Response `V3ChapterChatResponse`:

```ts
{
  kind: "talk" | "write" | "edit";
  assistantReply: string;
  pagesTexts?: V3PageTextsPatch[];
  layoutPatch?: V3LayoutPatchEntry[];
  usage: V3Usage;
}
```

Rules:

- `history.length` <= 20.
- `userMessage.length` <= 500.
- `kind=talk` returns only conversational guidance.
- `kind=write` may return `pagesTexts` for all text slots in the current chapter.
- `kind=edit` may return `layoutPatch` when page structure changes.

### 7.2 `POST /v3/recommend`

Request `V3RecommendRequest`:

```ts
{
  albumId: string;
  language: "zh" | "en";
  chapters: Array<{
    chapterId: string;
    description: string;
    photoDescs: string[];
  }>;
  analysisSummary?: string;
  userMessage?: string;
}
```

Response `V3RecommendResponse`:

```ts
{
  // #236: purely per-chapter — NO album-level themeOptions. `subject` is the
  // chapter's one-line title (作章节标题), grounded in that chapter's photos + story.
  chapterColors: Array<{
    chapterId: string;
    subject: string;
    accentColor: string;
    artFont: "serif-classic" | "sans-modern" | "script-elegant" | "display-bold";
  }>;
  assistantReply: string;
  usage: V3Usage;
}
```

Rules:

- `chapterColors` must cover every requested chapter exactly once; Web rejects off-contract coverage as `AGENT_INVALID_OUTPUT`.
- Each `subject` is non-empty; it becomes the chapter title when the user applies the theme.

### 7.3 `POST /v3/apply-theme`

Request `V3ApplyThemeRequest`:

```ts
{
  albumId: string;
  language: "zh" | "en";
  // #236: each chapter carries its `subject` (the user-confirmed chapter title);
  // apply-theme persists it into that chapter's `title` slot + brushes color/font.
  chapters: Array<{
    chapterId: string;
    subject: string;
    accentColor: string;
    artFont: "serif-classic" | "sans-modern" | "script-elegant" | "display-bold";
  }>;
  pages: Page[];
}
```

Response `V3ApplyThemeResponse`:

```ts
{
  layoutPatch: V3LayoutPatchEntry[];
  assistantReply?: string;
  usage: V3Usage;
}
```

Rules:

- No model call; deterministic transform only.
- `layoutPatch.length` must be at least 1.
- The Agent emits page patches for SVG/decor surfaces where applicable; it does not write tree-shaped color/font carriers.
- #236: the Agent ALSO writes each chapter's `subject` into that chapter's `title` role text slot (clamped to the slot `maxChars`) — the chapter title is persisted. Web folds this patch into `draft_json.pages` so the title survives reload/finalize. (This is a deterministic, user-confirmed write at the theme stage; it is NOT the analyze-stage invariant about what the LLM writes — that lives in `design.md`.)
- Web writes the chosen `accentColor/artFont` into the authoring tree and advances `theme -> cover` when applicable.
- Finalize bakes text color/font carriers from the authoring tree into flat render pages.

### 7.4 `POST /v3/cover`

Request `V3CoverRequest`:

```ts
{
  albumId: string;
  language: "zh" | "en";
  coverTemplateId?: string | null;
  endingTemplateId?: string | null;
  pages: Page[];
}
```

Response `V3CoverResponse`:

```ts
{
  layoutPatch: V3LayoutPatchEntry[];
  assistantReply?: string;
  usage: V3Usage;
}
```

Rules:

- `coverTemplateId` and `endingTemplateId` are optional independently.
- Skipping both is valid and returns an empty `layoutPatch`.
- Web folds non-empty patches into `draft_json.pages` when the stage can advance.

### 7.5 `POST /v3/finalize`

Request `V3FinalizeRequest`:

```ts
{
  albumId: string;
  language: "zh" | "en";
  tree: V3LayoutTree;
  pages: Page[];
}
```

Response `V3FinalizeResponse`:

```ts
{
  layout: AlbumLayoutPlan;
  usage: V3Usage;
}
```

Rules:

- This is the only sync endpoint that receives the complete authoring tree.
- It bakes chapter color/font carriers into render `pages[].texts`.
- Response `layout` must not contain tree-shaped fields.

---

## 8. State Machine

`albums.stage` is the V3 user-flow state and is owned by Web:

```ts
"analysing" | "story" | "theme" | "cover" | "ready"
```

Stage transitions:

| From | To | Owner | Trigger |
|---|---|---|---|
| `analysing` | `story` | Web | analyze completed callback |
| `story` | `theme` | Web | every chapter marked done |
| `theme` | `cover` | Web | apply-theme accepted and merged |
| `theme` | `ready` | Web | cover step skipped from theme |
| `cover` | `ready` | Web | cover/ending accepted or skipped |

`albums.status` is orthogonal:

```ts
"AGENT_RUNNING" | "EDITING" | "COMPLETED" | "FAILED"
```

- `status` tracks init lifecycle, user-visible completion, failure, and credit settlement.
- `stage` tracks current V3 editing ring and export gate.
- Do not derive either field from the other.

`agent_jobs.status` tracks async analyze jobs:

```ts
"QUEUED" | "RUNNING" | "COMPLETED" | "FAILED"
```

`agent_jobs.kind` remains Web's init job kind; callback `jobKind` remains `"analyze"`.

---

## 9. Error Codes

Agent error namespace:

| Code | Source | Surface |
|---|---|---|
| `AGENT_INVALID_INPUT` | strict request validation | HTTP 400 |
| `AGENT_UNAUTHORIZED` | missing/invalid bearer | HTTP 401 |
| `AGENT_VISION_FAILED` | recognition model, parse, or describe failure | analyze failed callback |
| `AGENT_PLANNING_FAILED` | text/planning model failure | HTTP 502 |
| `AGENT_OUTPUT_VALIDATION` | Agent produced an invalid patch/layout | HTTP 422 or analyze failed callback |
| `AGENT_TIMEOUT` | background analyze exceeded budget | analyze failed callback |
| `AGENT_INTERNAL_ERROR` | unknown exception | HTTP 500 or analyze failed callback |

Web mapping:

- Agent `AGENT_OUTPUT_VALIDATION` is persisted/exposed by Web as `AGENT_INVALID_OUTPUT`.
- Shared runtime failures keep their Agent code unless Web transport itself failed.
- Unknown Agent codes are not swallowed; Web keeps the code string for diagnostics.

---

## 10. Privacy Boundary

V3 privacy rules are part of the contract, not an implementation detail.

- Base64 appears only in `/v3/analyze` request memory.
- Stage0 only reads `takenAt`; it does not extract GPS or a place dimension. It may additionally emit an **opaque** `clusterId` (#232) derived locally from EXIF time/GPS — a same-place/same-time label, **never a coordinate or place name**.
- Grouping uses time, the opaque `clusterId` label (#232), and visual coherence from `describe`; it does not use coordinates.
- `exif` is strict and only allows `takenAt`. The analyze photo additionally allows `clusterId`; both are the **only** time/place-derived inputs, and `clusterId` carries no coordinate.
- There is no coordinate, GPS, `place`, or `location` field anywhere in the analyze request, `V3LayoutTree`, callbacks, or sync endpoint responses — `clusterId` does not relax this red line.
- Redact keys are defensive guardrails; seeing one in a log payload is a bug to scrub, not a contract field to preserve.
- `docs/agent/design.md §9` is the detailed redact and logging reference.
