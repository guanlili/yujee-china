# Yujee(遇己)

AI 人生纪念册 Web 应用,海外市场。选照片 → 秒级进编辑器 → AI 五环节(分析 → 章节故事 → 主题与章节色 → 书籍设计 → 待导出)→ 浏览器导出 PDF。

- **域名**:yujeeai.com · **UI**:英文 · **付费**:Creem · **初期目标**:1000 用户(简单优先)

## 三个组件

```
Browser ──► Web (Next.js) ──► Agent (FastAPI)
                │
                ▼
          Postgres + R2
```

- **Browser** — 唯一有原图的地方。压缩到 800px base64 发出;本地 `@react-pdf/renderer` 生成 PDF 直传 R2。
- **Web**(Next.js 15 + Drizzle + better-auth)— 页面 / 登录 / 积分 / 支付。base64 **不落盘**,直接转发 Agent;只存排版 JSON + PDF 元数据。
- **Agent**(Python + FastAPI)— 无状态,三真层(flows/agents/engine)+ 平铺边。识图模型做分析 + 版面主控,DeepSeek 写文案,确定性引擎做分组 / 套模板 / flatten / 校验。

## 技术栈

| 层 | 选型 |
|---|---|
| Web | Next.js 15 + React 19 + TypeScript |
| ORM | Drizzle + Neon Postgres |
| Auth | better-auth |
| Agent | Python 3.12 + FastAPI |
| 识图 / 版面 | 火山 doubao-vision(`ARK_*`,默认)/ OpenAI GPT(`OPENAI_*`)双槽 failover |
| 章节文案 | DeepSeek 槽(`DEEPSEEK_*`)|
| 排版引擎 | repo 内 React 模板(`apps/web/src/components/album/templates/`)|
| 对象存储 | Cloudflare R2(只存 PDF)|
| 部署 | Web → Vercel,Agent → Fly.io |

## 仓库结构

```
memoir-agent-rebuild/
├── apps/web/            # Next.js
├── apps/agent/          # FastAPI
├── packages/contracts/  # 跨服务 zod schema + TS 类型
└── docs/                # 架构与约定文档(见下)
```

> 新增顶层目录(`infra/`、`scripts/`、新 `packages/*`)先由架构师在 `docs/architecture.md` 登记,别自己建。

## 文档(都在 `docs/`,按需查,不用预读)

- **architecture.md** — 架构骨架 + §3 不变式(数据归属 / 积分变更;动手前自查)
- **agent/contract.md** — Web↔Agent 契约:req/res、错误码、状态机、Web 编排路由图
- **agent/design.md** — Agent 内部:pipeline、failover、校验、隐私 redact
- **web/layering.md** — Web 分层与边界(route / service / repo)
- **web/directory.md** — Web 目录约定
- **web/conventions.md** — Web 代码约定
- **web/database.md** — 表结构 / Drizzle / repo
- **web/errors.md** — 错误码与错误处理
- **web/api.md** — Web 对外 API(PDF / 营销 / 账单)
- **deploy/env.production.md** — 生产环境变量

## 必须先问架构师

加表 / 改 schema / 加顶层目录 / 加依赖 / 改对外 API / 改 Web↔Agent 协议 / 改不变式。

## 两条铁律

- **临时文件用完即删** — 调试 / 验证 / 一次性脚本用完立刻删,`git status` 不留临时产物;测试进正式套件,文档进 `docs/`。
- **改动 review + 推送** — 建分支 → 改 → review → 测试过 → 推 GitHub 开 PR;没过不推,不把工作留本地。
