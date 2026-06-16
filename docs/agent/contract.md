# Agent 对外契约

> **前置阅读**: `CLAUDE.md` → `docs/architecture.md`
>
> 谁读这份: 写 Agent 接入层(Web 这边),或写 Agent 服务本身的人。
>
> 这份文档**只定义对外协议**。内部 pipeline 实现(阶段边界、Prompt、火山/DeepSeek 调用、校验/repair、模板注册表、日志红线、mock/real 边界)在 [`docs/agent/design.md`](./design.md)。

---

## 1. 部署与基础信息

| 项 | 值 |
|---|---|
| 语言 | Python 3.12 + FastAPI |
| 部署 | Fly.io |
| 域名 | `agent.yujeeai.com` |
| 实例 | 单 region(初期),2 进程,512MB |
| 状态 | **完全无状态**——不连数据库,不存文件 |
| 鉴权 | Bearer Token,共享密钥 `AGENT_SHARED_SECRET` |

---

## 2. 暴露的接口

Agent **两个**业务端点 + 1 个健康检查。模式不同:

| 端点 | 模式 | 用途 |
|---|---|---|
| `POST /v1/layout` | 异步(202 + callback) | 首次生成,跑 vision → writing → composing |
| `POST /v1/chat-edit` | 同步(60s 超时) | Chat 修改已有 layout,跑单次 DeepSeek |
| `GET /health` | — | 健康检查 |

### 2.1 `POST /v1/layout` —— 主接口

请求头:
```
Authorization: Bearer <AGENT_SHARED_SECRET>
Content-Type:  application/json
X-Request-Id:  <uuid>
```

请求体:
```json
{
  "requestId": "req_xxx",
  "prompt": "我和妈妈在京都的春天",
  "language": "zh",
  "callbackUrl": "https://yujeeai.com/api/v1/internal/job-progress",
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
- `photos.length` ∈ [1, 30](架构 §6.5 决策 6:下限 3→1;1-2 图 composing 用纯文字版面兜底)
- 每张 base64 ≤ 800KB
- 总请求体 ≤ 25MB
- `prompt` ≤ 500 字

**工作模式(第一版只此一种,无可选)**:

Agent 收到 `POST /v1/layout` 后**立刻 202 接单**,把 layout 任务挂到 FastAPI `BackgroundTasks` 里跑,通过 `callbackUrl` 推进度和**终态**(`completed` / `failed`)。Web HTTP 响应只表示"我接到了",**不携带 layout**。

```
Web ──POST /v1/layout──► Agent  (后台 task 开始跑)
                          │
Web ◄──202 + {requestId}──┘   (立刻返回,Web HTTP 调用 ≤ 30 秒)

      [Agent 后台 task 期间]
                          ├─► POST callbackUrl  (event=progress, stage=vision,    progress=30)
                          ├─► POST callbackUrl  (event=progress, stage=writing,   progress=60)
                          ├─► POST callbackUrl  (event=progress, stage=composing, progress=90)
                          └─► POST callbackUrl  (event=completed, layout=...)   ← 终态
                                                or
                              POST callbackUrl  (event=failed, code=..., message=...)
```

- **终态走 callback**(`event=completed` 带 layout,或 `event=failed` 带错误码)。
- Web 不再阻塞等 90 秒。浏览器轮询 `GET /api/v1/jobs/[requestId]` 拿状态。
- callback 是 Agent 推终态的唯一通道,**Web 不会重试调 Agent**。
- 同一个 `requestId` 的 `completed` / `failed` callback 必须是**幂等**的(Web 用 `agent_jobs.status` 判重)。

**HTTP 响应体(接单成功)**:
```json
{
  "ok": true,
  "data": { "requestId": "req_xxx", "accepted": true }
}
```

**HTTP 响应体(接单失败 —— 仅在 Agent 都没把任务挂上去就拒绝时)**: HTTP status 4xx/5xx,body:
```json
{
  "ok": false,
  "error": { "code": "AGENT_INVALID_INPUT", "message": "photos.length must be 1-30" }
}
```

**callback 请求体(Agent → Web `callbackUrl`,discriminated union by `event`)**:

三种事件**字段不互通**(`extra: forbid`,见 [`design.md §8`](./design.md)):

```json
// event=progress
{ "requestId": "req_xxx", "event": "progress",
  "stage": "vision" | "writing" | "composing", "progress": 0-100, "message"?: "..." }

// event=completed
{ "requestId": "req_xxx", "event": "completed",
  "layout": { ... AlbumLayoutPlan ... },
  "usage": { ... see §4 ... } }

// event=failed
{ "requestId": "req_xxx", "event": "failed",
  "error": { "code": "AGENT_VISION_FAILED", "message": "..." },
  "stage"?: "vision" | "writing" | "composing",   // 失败时所在阶段
  "progress"?: 0-100 }                              // 失败时已跑到的进度
```

**进度语义**(design.md §6):每阶段至少发 2 次(开始 0、完成 100)。失败前必须先发一次 `progress`,再发 `failed` —— 前端 progress bar 不会从 50% 跳到失败。

> 为什么这样选:Vercel serverless 不能跨 lambda 共享 SSE 通道(见 `architecture.md §2`);改"Web fire-and-forget + Agent 回调推终态 + 浏览器轮询"后,Web 函数执行时长降到秒级,不存在 idle timeout 风险。1000 用户阶段轮询 QPS ≈ 总并发任务数 × 0.5,完全可承。

### 2.2 `POST /v1/chat-edit` —— Chat 编辑

请求头:
```
Authorization: Bearer <AGENT_SHARED_SECRET>
Content-Type:  application/json
X-Request-Id:  <uuid>
```

请求体:
```json
{
  "albumId": "alb_xxx",
  "currentLayout": { ... AlbumLayoutPlan ... },
  "history": [
    { "role": "user",      "content": "封面再大胆一点" },
    { "role": "assistant", "content": "好的,我把封面字号放大,加了一行副标题。" }
  ],
  "userMessage": "把第二页副标题改感性点",
  "language": "zh"
}
```

约束:
- `currentLayout` 必须通过 `AlbumLayoutPlan` zod 校验
- `history.length` ≤ 20(只送最近 N 条,Web 侧裁剪)
- `userMessage.length` ≤ 500
- **请求体不含**:`userId` / `email` / 原图 base64(全部隐私字段 Web 已剥)

**工作模式**:

```
Web ──POST /v1/chat-edit──► Agent  (单次 DeepSeek 调用)
                            │
                            ├─ 拼 system prompt:layout schema + TemplateRegistry + 业务规则
                            ├─ 拼 user prompt:currentLayout + history + userMessage
                            ├─ 调 DeepSeek(结构化 JSON 输出)
                            ├─ 解析 + 校验 layoutPatch
                            │   → 失败 → repair 1 次
                            │   → repair 仍失败 → 502 AGENT_CHAT_FAILED
                            └─ 200 + { layoutPatch, assistantReply, usage }
```

**成功响应**(HTTP 200):
```json
{
  "ok": true,
  "data": {
    "layoutPatch": [
      {
        "pageIndex": 1,
        "textsJson": { "subtitle": "春天总是来得太早" }
      }
    ],
    "assistantReply": "已经把第二页副标题改成「春天总是来得太早」,语气更感性。",
    "usage": {
      "durationMs": 4200,
      "planningInputTokens": 1820,
      "planningOutputTokens": 142,
      "repairAttempts": 0,
      "model": "deepseek-chat"
    }
  }
}
```

**失败响应**:
```json
{
  "ok": false,
  "error": { "code": "AGENT_CHAT_FAILED", "message": "..." }
}
```

**约束**:
- `layoutPatch` 是 `Page` 的**部分字段**数组,每项必须有 `pageIndex`,其他字段(`templateId` / `images` / `texts`)按需出现
- patch 不允许新增/删除页(只改字段);需要换模板时,assistant 在 reply 里说明并按整页替换 `templateId` + `images` + `texts`
- patch apply 后 layout 必须**仍然通过** §4 全量 schema 校验(Agent 端校验通过才发出来,Web 端 apply 后再校验一次兜底)

**错误码**:见 §8。

### 2.3 `GET /health`

```json
{ "ok": true, "version": "1.0.0", "timestamp": "2026-05-27T12:00:00Z" }
```

---

## 3. Agent 调用的外部接口

Agent → Web 回调(**progress / completed / failed 三种事件都走这一个端点**):

```
POST https://yujeeai.com/api/v1/internal/job-progress
Headers:
  Authorization: Bearer <AGENT_SHARED_SECRET>
  Content-Type:  application/json
```

Body 同 §2.1 callback 请求体(`event` 字段区分类型)。

详细 Web 侧处理 → `docs/web/api.md §3.3`。

---

## 4. AlbumLayoutPlan 完整 schema

这是 Agent 输出的核心契约。**任何字段变更必须先改 `packages/contracts/src/agent.ts`**,Web/Agent 两端都从这里读类型。

```ts
// packages/contracts/src/agent.ts (示意)
import { z } from 'zod';

export const PhotoOrientation = z.enum(['portrait', 'landscape', 'square']);
export const PhotoQuality = z.enum(['hero', 'detail', 'fill']);

export const Magazine = z.object({
  title: z.string().min(1).max(60),
  subtitle: z.string().max(100).optional(),
  style: z.string(),                    // 风格 ID,见 config/templates
  language: z.enum(['zh', 'en']),
});

export const PhotoAnalysis = z.object({
  photoId: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  quality: PhotoQuality,
  orientation: PhotoOrientation,
  // ↓ design.md §2.3 扩充,vision 阶段输出
  peopleCount: z.enum(['0', '1', '2-3', '4+']),
  scene: z.enum(['indoor', 'outdoor', 'nature', 'city', 'interior']),
  mood: z.enum(['warm', 'cool', 'sentimental', 'energetic', 'quiet']),
  timeOfDay: z.enum(['morning', 'day', 'evening', 'night']).nullable().optional(),
  location: z.string().nullable().optional(),
});

// #165: 每槽位的位置/缩放覆盖。key = 与 images 同名的 slotId。缺省即默认 50/50/1。
export const ImagePos = z.object({
  x: z.number().min(0).max(100),   // object-position 横向百分比,clamp [0,100]
  y: z.number().min(0).max(100),   // object-position 纵向百分比,clamp [0,100]
  scale: z.number().min(1).max(2), // 放大倍数,clamp [1,2];仅 web 生效,PDF 暂不支持 zoom
});

export const Page = z.object({
  pageIndex: z.number().int().nonnegative(),
  templateId: z.string(),                // 必须在 config/templates 里存在
  images: z.record(z.string(), z.string()),  // { slotName: photoId }
  texts: z.record(z.string(), z.string()),   // { slotName: text }
  imagePos: z.record(z.string(), ImagePos).optional(), // #165 可选,缺省=默认 50/50/1
});

export const AlbumLayoutPlan = z.object({
  magazine: Magazine,
  photos: z.array(PhotoAnalysis),
  pages: z.array(Page).min(1),
});
```

### 4.0 `imagePos` 单图位置覆盖(#165 Phase 1,架构已批准登记)

- **形状**:`Page.imagePos?: Record<slotId, { x: number; y: number; scale: number }>`,与 `images` 用同一套 slotId(`image` / `imageTop` / `cells[0].image` 等)。**可选**:缺省该 slot 即渲染器回退默认 `objectPosition 50% 50%`、`objectFit cover`、不缩放。因此**所有 #165 之前的相册逐字节不变**。
- **clamp 边界**:`x,y in [0,100]`,`scale in [1,2]`(zod / pydantic / web layout-schema 三处同步校验,inv 9)。写入者(#165 Phase 3 `adjust_image_position`)负责落在该范围。
- **finalize 拍平(inv 12)**:`AlbumDraft` 各 chapter/cover 页的 `imagePos` 在 `services/finalize.py` 拍平进扁平 `LayoutV2.pages`,再由 Web `handleFinalizeCompleted` 落 `album_pages.image_pos_json`(缺省落 `{}`,渲染默认)。指向已不在 `images` 里的 slot 的陈旧覆盖在拍平时丢弃。
- **photo-swap 重置**:换图(slot 的 photoId 变化)即清掉该 slot 的 `imagePos`(新主体回 50/50/1),由 `applyPatchToPages` 在编辑器侧执行后再持久化。
- **TS<->py 镜像**:`packages/contracts/src/layout.ts` `ImagePos`/`Page.imagePos` 对应 `apps/agent/src/schemas.py` `ImagePos`/`Page.imagePos`;Web 校验副本 `apps/web/src/lib/agent/layout-schema.ts` 同步。
- **PDF 限制**:`@react-pdf <Image>` 无 transform,`scale>1` 暂不缩放(只用 objectPosition 平移),为 web-only,见 `pdf-utils.tsx` 的 `TODO(#165)`。

### 4.1 Composing 二期语义(文档说明,非 schema 变更)

本节只说明 layout 规则语义,**不新增协议字段、不改 zod schema**:

- `PhotoAnalysis.orientation` 仍然保留在输出里,供模型做软偏好与渲染调试参考;但它不再是确定性 layout validation 的硬规则。orientation 错配不应单独触发 repair / failed。
- 页数不再按 `max(3, ceil(photos.length / 2.5))` 公式强制相等;Agent 可按实际内容排页,但最终 `pages` 仍必须落在 **1..16** 边界内。
- `Page.images` 的 value 仍然只能是 `photoId`,不得输出 URL / 原图地址 / 临时图片地址。`photoId → 原图` 的映射只在浏览器本地完成。
- callback envelope 不变:仍然只有 `progress` / `completed` / `failed` 三个 variant,字段集按 §2.1,不新增包裹层或额外事件类型。

---

## 5. 进度 stage 枚举

| stage | 用户看到 |
|---|---|
| `vision` | "AI 在看图" |
| `writing` | "AI 在写文案" |
| `composing` | "AI 在排版" |

Agent 在每个阶段开始时 POST 一次 progress=0,中途可以 POST 多次,阶段结束时 POST progress=100。

---

## 6. 超时与重试

| 场景 | 策略 |
|---|---|
| Web → Agent `/v1/layout`(接单) | 30 秒。超时后 Web 标记 job=FAILED,**不自动重试**。 |
| Web → Agent `/v1/chat-edit`(同步) | 60 秒。超时返回 504 `AGENT_CHAT_FAILED`,**不自动重试**(用户在等)。 |
| Agent 后台 task 总时长(layout) | 软上限 180 秒。超时 Agent 自己 POST `event=failed` callback,code=`AGENT_TIMEOUT`。 |
| Agent → 火山 | 30 秒。Agent 内部重试 1 次。 |
| Agent → DeepSeek(planning / writing / chat-edit / composing) | 60 秒。Agent 内部重试 1 次。(composing 同一 slot,见 [`design.md`](./design.md))|
| Agent → callbackUrl | 10 秒。失败重试 2 次(指数退避 1s / 4s)。所有重试都失败后,任务在 Agent 侧就**丢失了** —— Web 侧 zombie sweeper(每 60s 扫,阈值 5min)会兜底标 FAILED 并释放积分,见 [`design.md §7`](./design.md)。 |
| 浏览器 → Web (轮询) | 不需要超时配置,失败重试下一次。 |
| 浏览器 → Web (chat) | 65 秒(Agent 60 + 缓冲 5)。超时显示"AI 没回话,请重试"。 |

---

## 7. 鉴权

`AGENT_SHARED_SECRET` 是 32 字节随机字符串,Web 和 Agent 各自从 env 读。

- Web → Agent: `Authorization: Bearer ${SECRET}`
- Agent → Web `/api/v1/internal/job-progress`: 同上

任一方校验失败 → 401 `AGENT_UNAUTHORIZED`。

**不允许**:
- 写在代码里
- 出现在客户端 bundle 里
- 写到日志里

---

## 8. 错误码(Agent 内部产生)

Agent 失败时通过 `POST /v1/layout` 的 **HTTP 非 2xx 响应** 返回这些 code(见 §2.1 失败响应体):

| code | HTTP status | 含义 |
|---|---|---|
| `AGENT_INVALID_INPUT` | 400 | 请求体不合法 |
| `AGENT_UNAUTHORIZED` | 401 | Bearer 校验失败 |
| `AGENT_VISION_FAILED` | 502 | 火山识图调用失败/超时 |
| `AGENT_PLANNING_FAILED` | 502 | DeepSeek 排版调用失败/超时(layout 阶段) |
| `AGENT_OUTPUT_VALIDATION` | 502 | 内部生成的 layout 校验未通过 |
| `AGENT_CHAT_FAILED` | 502 / 504 | Chat-edit 调用失败 / patch 校验失败 / 60s 超时 |
| `AGENT_INTERNAL_ERROR` | 500 | 其他未知 |

Web 收到后会映射到自己的错误码体系(`docs/web/errors.md`)。

---

## 9. 接入端实现要点(Web 这边)

### 9.1 `lib/agent/agent-client.ts`

```ts
import { env } from '@/lib/env';

export const agentClient = {
  // fire-and-forget:Web 只关心 Agent 有没有接单。终态走 callback。
  async submitLayout(payload: AgentRequest): Promise<{ requestId: string }> {
    const res = await fetch(`${env.AGENT_BASE_URL}/v1/layout`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.AGENT_SHARED_SECRET}`,
        'Content-Type': 'application/json',
        'X-Request-Id': payload.requestId,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 401) throw ERRORS.AGENT_UNAUTHORIZED();
    if (res.status === 400) throw ERRORS.VALIDATION_FAILED('agent rejected');
    if (!res.ok) throw ERRORS.AGENT_INTERNAL_ERROR();
    return { requestId: payload.requestId };
  },

  // 同步:用户在等。返回 layoutPatch + assistantReply。
  async chatEdit(payload: ChatEditRequest): Promise<ChatEditResponse> {
    const res = await fetch(`${env.AGENT_BASE_URL}/v1/chat-edit`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.AGENT_SHARED_SECRET}`,
        'Content-Type': 'application/json',
        'X-Request-Id': crypto.randomUUID(),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60_000),
    });
    if (res.status === 401) throw ERRORS.AGENT_UNAUTHORIZED();
    if (!res.ok) throw ERRORS.AGENT_CHAT_FAILED();
    const json = await res.json();
    return json.data;
  },
};
```

### 9.2 `/api/v1/internal/job-progress` 路由要点

- 校验 `Authorization: Bearer`,失败 → 401。
- 按 `body.event` 分发到 `jobService`:
  - `progress` → 更新 `agent_jobs.stage` / `progress`
  - `completed` → 同一事务里:zod 校验 layout → 写 `album_pages` + `albums.layout_json` + `status='EDITING'` + `creditService.hold`
  - `failed` → 写 `albums.status='FAILED'` + `error_message` + `creditService.release`
- **幂等**:若 `agent_jobs.status` 已经是 `COMPLETED` / `FAILED`,直接返回 200,不重复写。
- 所有写完后返回 `{ ok: true }`。浏览器靠下一次轮询拿到终态。

详见 `docs/web/api.md §3.3`。

---

## 10. 环境变量

### Agent 端 (`apps/agent/.env`)
```
# 鉴权
AGENT_SHARED_SECRET=<同 Web>

# Web 回调
WEB_BASE_URL=https://yujeeai.com

# 模型
ARK_API_KEY=...
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
ARK_VISION_MODEL=doubao-seed-1-6-vision-250815
DEEPSEEK_API_KEY=...
DEEPSEEK_BASE_URL=https://api.deepseek.com

# 限制
MAX_PHOTOS_PER_REQUEST=30
BACKGROUND_TASK_TIMEOUT_SECONDS=180

# Observability
SENTRY_DSN=...
LOG_LEVEL=info
```

### Web 端调 Agent 需要 (`apps/web/.env`)
```
AGENT_BASE_URL=https://agent.yujeeai.com
AGENT_SHARED_SECRET=<同 Agent>
```

---

## 11. 自查

- [ ] 我对 Agent 的请求/响应字段都按 §2、§4 来吗?
- [ ] 我处理了所有 §8 的错误码吗?
- [ ] Bearer Token 是不是从 env 读,没硬编码?
- [ ] Layout JSON 写库前 zod 校验了吗?
- [ ] 如果改了协议,有没有同步 `packages/contracts/src/agent.ts`?
