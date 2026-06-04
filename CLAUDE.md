# Yujee(遇己)

AI 人生纪念册 Web 应用,海外市场。用户输入文字 + 选照片 → AI 排版 → 用户编辑 → 浏览器导出 PDF。

- **域名**:yujeeai.com
- **形态**:Web 应用,英文 UI
- **付费**:Creem
- **初期目标**:1000 用户(简单优先);长期 10 万用户(留扩展接口,第一版不实施)

## 三个组件

```
Browser ──► Web (Next.js) ──► Agent (FastAPI)
                │
                ▼
          Postgres + R2
```

- **Browser**:唯一拥有原图的地方。Canvas 压缩到 800px / base64 → 发出去。本地用 `@react-pdf/renderer` 生成 PDF → 直传 R2。
- **Web** (Next.js 15 + Drizzle + better-auth):页面 / 登录 / 积分 / 支付。base64 收到后**不落盘**,直接转发 Agent。只保存排版 JSON 和 PDF 元数据。
- **Agent** (Python + FastAPI):无状态。调火山 doubao-vision 识图 + DeepSeek 排版 → 输出 layout JSON。

核心承诺:**原图永远不落服务器**。

## 技术栈

| 层 | 选型 |
|---|---|
| Web | Next.js 15 + React 19 + TypeScript |
| ORM | Drizzle + Neon Postgres |
| Auth | better-auth |
| Agent | Python 3.12 + FastAPI |
| 识图 | 火山 doubao-seed-1-6-vision |
| 排版规划 | DeepSeek |
| 排版引擎 | 复用 `../memoir/` 的 React 模板,21 个版式 |
| 对象存储 | Cloudflare R2(只存 PDF)|
| 部署 | Web → Vercel,Agent → Fly.io |

## 仓库结构

```
memoir-agent-rebuild/
├── apps/
│   ├── web/        # Next.js
│   └── agent/      # FastAPI
├── packages/
│   └── contracts/  # 跨服务 zod schema + TS 类型
└── docs/           # 所有架构文档,按角色加载
```

> 新增顶层目录(如 `infra/`、`scripts/`、新 `packages/*`)必须先由架构师在 `docs/architecture.md` 里登记。AI 工程师不要自己建。

---

## 接到任务怎么开始

1. 读 [`docs/architecture.md`](./docs/architecture.md)(架构骨架 + 十条不变式)
2. 在下面表格找角色,**按顺序**读列出的起手文档
3. 动手前对照"十条不变式"自查

> 角色清单是**起手必读**,不是天花板。任务过程中遇到清单外的细节(如表字段、错误码、协议字段),按需打开对应子文档查证;但不要预先把所有文档读一遍。

### 角色 → 必读文档

| 角色 | 必读(按顺序) |
|---|---|
| Web · 基建 | architecture → web/layering → web/directory → web/conventions → web/database → web/errors |
| Web · DB / Repo | architecture → web/layering → web/database → web/conventions |
| Web · API | architecture → web/layering → web/api → web/conventions → web/errors |
| Web · Service | architecture → web/layering → web/conventions → web/errors → web/database |
| Web · UI · 创建页 | architecture → web/api → web/conventions |
| Web · UI · 编辑器 | architecture → web/api → web/conventions |
| Web · UI · PDF | architecture → web/api → web/conventions |
| Web · UI · 营销 / 账单 | architecture → web/conventions → web/api |
| Agent · 接入(Web 侧)| architecture → agent/contract → web/api |
| Agent · 内部 pipeline | architecture → agent/contract → agent/design |
| Contracts | architecture → agent/contract → web/database |
| Infra | architecture + 各文档末尾的「环境变量」小节 |
| 架构师 / Reviewer | 全部 |

文档位置:`docs/architecture.md`、`docs/web/*.md`、`docs/agent/*.md`。

> 十条不变式的**完整版**在 [`docs/architecture.md §3`](./docs/architecture.md)。动手前对照原文自查,不要凭记忆。

### 必须先问架构师

加表 / 改 schema / 加顶层目录 / 加依赖 / 改对外 API / 改 Web↔Agent 协议 / 改不变式。
