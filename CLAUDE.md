# Yujee(遇己)

AI 人生纪念册 Web 应用,海外市场。选照片 → 秒级进编辑器 → AI 五环节生成与编辑(分析 → 章节故事 → 确定主题与章节色 → 书籍设计 → 待导出)→ 浏览器导出 PDF。

- **域名**:yujeeai.com
- **形态**:Web 应用,英文 UI
- **付费**:Creem
- **初期目标**:1000 用户(简单优先)

## 三个组件

```
Browser ──► Web (Next.js) ──► Agent (FastAPI)
                │
                ▼
          Postgres + R2
```

- **Browser**:唯一拥有原图的地方。Canvas 压缩到 800px / base64 → 发出去。本地用 `@react-pdf/renderer` 生成 PDF → 直传 R2。
- **Web** (Next.js 15 + Drizzle + better-auth):页面 / 登录 / 积分 / 支付。base64 收到后**不落盘**,直接转发 Agent。只保存排版 JSON 和 PDF 元数据。
- **Agent** (Python + FastAPI):无状态。识图模型(GPT-5.5 Mini 主 / 火山 doubao-vision failover)做图片分析 + 版面主控,DeepSeek 写章节文案,确定性引擎做分组/套模板/flatten/校验。


## 技术栈

| 层 | 选型 |
|---|---|
| Web | Next.js 15 + React 19 + TypeScript |
| ORM | Drizzle + Neon Postgres |
| Auth | better-auth |
| Agent | Python 3.12 + FastAPI |
| 识图 / 版面主控 | GPT-5.5 Mini(主,OpenAI 兼容槽)/ 火山 doubao-vision(failover)|
| 章节文案 | DeepSeek |
| 排版引擎 | repo 内 React 模板(`apps/web/src/components/album/templates/`) |
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

1. 读 [`docs/architecture.md`](./docs/architecture.md)(架构骨架 + §3 不变式)
2. 在下面表格找角色,**按顺序**读列出的起手文档
3. 动手前对照 §3 不变式(数据归属 / 积分变更两类重点)自查

> 角色清单是**起手必读**,不是天花板。任务过程中遇到清单外的细节(如表字段、错误码、协议字段),按需打开对应子文档查证;但不要预先把所有文档读一遍。

### 角色 → 必读文档

> V3 起手入口 = `docs/agent/contract.md`(Web <-> Agent 契约)+ `docs/agent/design.md`(Agent 内部 pipeline)。`docs/agent/v3-requirements.md` 保留需求背景,`docs/agent/v3-implementation-plan.md` 保留 WP 拆解。

| 角色 | 必读(按顺序) |
|---|---|
| Web · 基建 | architecture → web/layering → web/directory → web/conventions → web/database → web/errors |
| Web · DB / Repo | architecture → web/layering → web/database → web/conventions |
| Web · API | architecture → web/layering → web/api → web/conventions → web/errors |
| Web · Service | architecture → web/layering → web/conventions → web/errors → web/database |
| Web · UI · 创建页 / 编辑器 | architecture → v3-requirements(§2 五环节 + §4 逐环节)→ web/api → web/conventions |
| Web · UI · PDF / 营销 / 账单 | architecture → web/api → web/conventions |
| Agent · 接入(Web 侧)| architecture → agent/contract → web/api |
| Agent · 内部 pipeline | architecture → agent/contract → agent/design |
| Contracts / 模板 | architecture → v3-requirements §8·§9 → web/database |
| Infra | architecture + 各文档末尾的「环境变量」小节 |
| 架构师 / Reviewer | architecture → agent/contract → agent/design;**其余按所设计/评审的模块对应行按需读,不预读全部** |

文档位置:`docs/architecture.md`、`docs/web/*.md`、`docs/agent/*.md`。

> `docs/agent/contract.md` 是 V3 req/res、错误码、状态机入口;`docs/agent/design.md` 是 V3 pipeline、failover、validation、redact 入口。
>
> §3 不变式(两类重点:**数据归属 / 积分变更**)动手前对照原文自查,不要凭记忆。

### 必须先问架构师

加表 / 改 schema / 加顶层目录 / 加依赖 / 改对外 API / 改 Web↔Agent 协议 / 改不变式。

---

## 临时文件 · 用完即删(铁律)

> 调试 / 验证 / 截图 / 一次性排查时产生的**临时文档、临时测试文件、临时预览路由、一次性脚本**(不论放顶层目录还是任何子目录),**用完必须立即删除,绝不留在仓库里**。
>
> - 测试进正式套件(`*.test.ts`、`apps/agent/tests/test_*.py`),**不准写成 `.txt`/`.log` 散落文件**;文档进 `docs/`。
> - 任务结束前 `git status` 不留没人引用的临时产物。

---

## 改动必须 review + 推送(铁律)

> 建分支 → 改 → review → 测试过 → 推 GitHub 开 PR。review/测试没过不推,**不把工作留在本地**。
