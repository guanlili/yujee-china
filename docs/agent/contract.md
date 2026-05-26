# Agent 对外契约

> **前置阅读**: `CLAUDE.md` → `docs/architecture.md`
>
> 谁读这份: 写 Agent 接入层(Web 这边),或写 Agent 服务本身的人。
>
> 这份文档**只定义对外协议**。内部 pipeline 实现(怎么调火山、怎么写 prompt、怎么匹配模板)在 `docs/agent/design.md`(后续写)。

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
- `photos.length` ∈ [3, 30]
- 每张 base64 ≤ 800KB
- 总请求体 ≤ 25MB
- `prompt` ≤ 500 字

**工作模式(第一版只此一种,无可选)**:

Agent 收到 `POST /v1/layout` 后**立刻 202 接单**,把 layout 任务挂到 FastAPI `BackgroundTasks` 里跑,通过 `callbackUrl` 推进度和**终态**(`completed` / `failed`)。Web HTTP 响应只表示"我接到了",**不携带 layout**。

```
Web ──POST /v1/layout──► Agent  (后台 task 开始跑)
                          │
Web ◄──202 + {requestId}──┘   (立刻返回,Web HTTP 调用 ≤ 5 秒)

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
  "error": { "code": "AGENT_INVALID_INPUT", "message": "photos.length must be 3-30" }
}
```

**callback 请求体(Agent → Web `callbackUrl`,统一信封)**:

```json
{
  "requestId": "req_xxx",
  "event": "progress" | "completed" | "failed",
  "stage": "vision" | "writing" | "composing",   // progress 必填,其他可空
  "progress": 30,                                  // progress 必填(0-100)
  "message": "已看完 5/15 张",                      // 可选
  "layout": { ... AlbumLayoutPlan ... },           // completed 必填
  "error": { "code": "AGENT_VISION_FAILED",
             "message": "..." },                   // failed 必填
  "usage": { "visionTokens": 12000,
             "planningTokens": 4000,
             "durationMs": 38000 }                 // completed 时携带
}
```

> 为什么这样选:Vercel serverless 不能跨 lambda 共享 SSE 通道(见 `architecture.md §2`);改"Web fire-and-forget + Agent 回调推终态 + 浏览器轮询"后,Web 函数执行时长降到秒级,不存在 idle timeout 风险。1000 用户阶段轮询 QPS ≈ 总并发任务数 × 0.5,完全可承。

### 2.2 `GET /health`

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
});

export const Page = z.object({
  pageIndex: z.number().int().nonnegative(),
  templateId: z.string(),                // 必须在 config/templates 里存在
  images: z.record(z.string(), z.string()),  // { slotName: photoId }
  texts: z.record(z.string(), z.string()),   // { slotName: text }
});

export const AlbumLayoutPlan = z.object({
  magazine: Magazine,
  photos: z.array(PhotoAnalysis),
  pages: z.array(Page).min(1),
});
```

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
| Web → Agent(接单) | 5 秒。超时后 Web 标记 job=FAILED,**不自动重试**。 |
| Agent 后台 task 总时长 | 软上限 180 秒。超时 Agent 自己 POST `event=failed` callback,code=`AGENT_TIMEOUT`。 |
| Agent → 火山 | 30 秒。Agent 内部重试 1 次。 |
| Agent → DeepSeek | 30 秒。Agent 内部重试 1 次。 |
| Agent → callbackUrl | 10 秒。失败重试 2 次(指数退避 1s / 4s)。所有重试都失败后,任务在 Agent 侧就**丢失了** —— Web 仅靠 `agent_jobs.created_at + 5 分钟` 兜底扫描标 FAILED。 |
| 浏览器 → Web (轮询) | 不需要超时配置,失败重试下一次。 |

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
| `AGENT_PLANNING_FAILED` | 502 | DeepSeek 排版调用失败/超时 |
| `AGENT_OUTPUT_VALIDATION` | 502 | 内部生成的 layout 校验未通过 |
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
      signal: AbortSignal.timeout(5_000),
    });
    if (res.status === 401) throw ERRORS.AGENT_UNAUTHORIZED();
    if (res.status === 400) throw ERRORS.VALIDATION_FAILED('agent rejected');
    if (!res.ok) throw ERRORS.AGENT_INTERNAL_ERROR();
    return { requestId: payload.requestId };
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
