# Yujee 架构(入口文档)

> 这是项目的入口骨架。**不要在这份文档里塞细节**——所有规范、目录、协议、schema 都拆到了子文档里,按需加载。
>
> 阅读方法见根目录 `CLAUDE.md`。

---

## 0. 产品基线

| 项 | 值 |
|---|---|
| 产品名 | Yujee(遇己)|
| 域名 | yujeeai.com |
| 形态 | AI 人生纪念册 Web 应用,海外市场,英文 UI |
| 用户路径 | 输入文字 + 选照片 → AI 排版 → 用户编辑 → 浏览器导出 PDF |
| 初期容量目标 | 1000 用户(简单优先)|
| 长期容量目标 | 10 万用户(预留扩展,但**第一版不实施**)|

---

## 1. 系统切分:三个组件

```
┌─────────────────────┐        ┌──────────────────────┐         ┌──────────────────┐
│      Browser        │        │  Web (Next.js 15)    │         │ Agent (FastAPI)  │
│                     │        │                      │         │                  │
│ • 选照片            │        │ • 页面/登录/积分/支付 │         │ • 调火山识图     │
│ • 浏览器压缩 base64 │ ─────► │ • 转发图片到 Agent   │ ──────► │ • 调 DeepSeek 排版│
│ • 轮询 job 状态     │ ◄───── │ • 保存排版 JSON      │ ◄────── │ • 推 progress    │
│ • 本地渲染 PDF      │        │ • PDF 上传/分发      │         │ • 推终态 callback│
│ • PDF 上传 R2       │ ─────► │                      │         │ • 不存任何数据   │
└─────────────────────┘        └──────────────────────┘         │ • 无状态         │
                                         │                       └──────────────────┘
                                         ▼
                              ┌──────────────────────┐
                              │ Postgres (Neon)      │
                              │ R2 (Cloudflare)      │
                              └──────────────────────┘
```

### 1.1 三个组件的职责边界

**Browser**
- 唯一拥有原图的地方。原图永远不出浏览器。
- Canvas 压缩到 800px、quality 0.6 → base64 data URL 作为"特征载体"。
- 拿到排版 JSON 后用 React 模板渲染预览。
- 用户点导出 → 浏览器本地用 `@react-pdf/renderer` 生成 PDF → 直传 R2。

**Web (Next.js)**
- 唯一与用户、数据库、支付打交道的组件。
- 收到 base64 后**不落盘、不存 R2、不写日志**,直接转发给 Agent。
- 保存的是排版 JSON,不是图片。
- PDF 上传走 R2 presigned PUT,Web 不过 PDF 流量。

**Agent (FastAPI)**
- 无状态服务。无数据库连接。无文件系统持久化。
- 接收 base64 数组 + 用户文本 → 火山识图 → DeepSeek 排版 → 返回 JSON。
- 不直接被浏览器调用,只被 Web 调用。

### 1.2 为什么这样切

1. **图片不落盘** —— 用户隐私是核心承诺。Web 和 Agent 都不存原图。
2. **Web 不做 AI** —— Next.js serverless 不适合长任务和大依赖。
3. **Agent 不碰用户数据** —— Agent 只看到 base64 和文本,挂掉只影响生成,不影响登录/支付/已有作品。
4. **PDF 在浏览器生成** —— 原图始终在本地。Web 只签 URL,不接 PDF 流量。

---

## 2. Web ↔ Agent 协议(骨架)

- **传输模式**:异步 HTTP(Web 立刻返回,Agent 后台跑,浏览器轮询拿状态)
- **入口**:`POST https://agent.yujeeai.com/v1/layout` — Agent 接单后立刻 `202 Accepted` 返回,在后台 task 里跑
- **进度 / 终态回推**:Agent → Web `POST /api/v1/internal/job-progress`,事件类型 `progress` / `completed` / `failed`
- **浏览器侧**:不开长连接、不开 SSE。每 2 秒轮询 `GET /api/v1/jobs/[requestId]` 拿 `stage` / `progress` / `status`,看到 `COMPLETED` / `FAILED` 停轮询
- **鉴权**:Bearer Token,共享密钥 `AGENT_SHARED_SECRET`
- **超时**:Web → Agent 接单 5 秒;Agent → 外部模型 30 秒,重试 1 次;Agent → Web callback 10 秒,重试 2 次

**为什么不用 SSE**:Vercel serverless 多 lambda 实例,进程内 EventEmitter 无法跨实例,SSE 接收端和回调接收端不在同一进程,**1 个用户就不通**。轮询零依赖、零运维、Vercel 上必然工作,1000 用户阶段足够。

**详细 req/res、错误码、状态机** → 见 [`docs/agent/contract.md`](./agent/contract.md)。

---

## 3. 十条不变式(违反 = bug)

1. 浏览器原图**永远不写入数据库,不存 R2**(只 base64 临时穿过 Web)。
2. Web 收到 base64 后**只转发给 Agent**,不写日志、不落盘。
3. Agent 处理完请求**不留任何数据**,无状态。
4. PDF 由浏览器生成,通过 presigned PUT 上传 R2,Web 不接 PDF 流量。
5. 所有 API route.ts ≤ 40 行,业务逻辑全在 service。
6. Route 不 import drizzle,Service 不 import 其他 service 的 repo。
7. 所有 service 方法第一参数是 `userId` 或 `actor`,数据归属明确。
8. 所有积分变更必须在 DB 事务里,和 album 状态变更原子。
9. Agent 输出的 layout 写库前必须 zod 校验。
10. `AGENT_SHARED_SECRET` 不允许出现在任何 client bundle 里。

---

## 4. 项目目录(顶层)

```
memoir-agent-rebuild/
├── apps/
│   ├── web/
│   │   ├── src/              # Next.js 源码       → docs/web/*
│   │   └── design-v1/        # V1 UI 实现稿(HTML),React 化前的视觉权威源
│   └── agent/                # FastAPI 服务       → docs/agent/*
├── packages/
│   └── contracts/            # 跨服务 zod schema + TS 类型
├── docs/                     # 所有架构文档
└── CLAUDE.md                 # 工程入口,所有 agent 必读
```

> `apps/web/design-v1/` 不参与构建,只是 React 化时的视觉/token/i18n key 真相源。详见 [`apps/web/design-v1/README.md`](../apps/web/design-v1/README.md)。

**目录扩张规则**:新增顶层目录(`infra/` / `scripts/` / 新 `packages/*`)、或在 `apps/web/src` / `apps/agent/src` 下加顶层目录,**必须先由架构师在本文件登记**,再让工程师建。AI 工程师不能自己设计目录结构,只能往已登记的目录里填代码。

详细目录到文件级 → 见 [`docs/web/directory.md`](./web/directory.md)、[`docs/agent/contract.md`](./agent/contract.md)。

---

## 5. 部署

| 服务 | 平台 | 域名 |
|---|---|---|
| Web | Vercel | yujeeai.com |
| Agent | Fly.io | agent.yujeeai.com |
| Postgres | Neon | (内部连接)|
| R2 / CDN | Cloudflare | cdn.yujeeai.com |

环境变量完整清单 → 见各子文档结尾。

---

## 6. 扩展到 10 万用户的路径(未来,**第一版不实施**)

| 阈值 | 行动 |
|---|---|
| Agent QPS > 5 | 加 Redis 队列 + Python worker |
| 浏览器轮询 QPS > 200 | 上 SSE/WebSocket(配 Upstash Redis pubsub 跨实例广播)|
| Postgres 写 > 100 QPS | 给 `albums` / `agent_jobs` 加分表或归档 |
| 单次生成成本 > $0.20 | 加结果缓存(按 prompt + photo hashes 命中)|

第一版**不留任何抽象**给这些扩展。YAGNI。

---

## 7. 怎么读这份文档系列

不要从头到尾读 `docs/`。按角色加载:

1. **任何任务开始前** → 读 `CLAUDE.md`(根目录,~150 行)
2. 在 `CLAUDE.md` 找你的**角色行**,看起手必读清单
3. 按清单**一份一份读**,读完一份再读下一份
4. 任务过程中遇到清单外的细节(如表字段、错误码、协议字段),按需查对应子文档

完整角色→文档映射表在 `CLAUDE.md` §3。
