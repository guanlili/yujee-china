# Yujee(遇己)

AI 人生纪念册 Web 应用,面向海外市场。用户选择照片后进入编辑器,系统完成识图分章、排版候选、用户编辑和浏览器导出 PDF。

`docs/` 已删除。仓根 README 只放大的框架;Web 和 Agent 的内部实现分别看子目录 README。

## 系统框架

```text
Browser -> Web (Next.js) -> Agent (FastAPI)
             |
             v
       Postgres + Cloudflare R2
```

| 部分 | 主要职责 |
|---|---|
| Browser | 持有原图, 压缩/缓存照片, 读取 EXIF, 渲染编辑器, 渲染排版候选缩略图, 本地生成 PDF 后直传 R2 |
| Web | 登录、支付、积分、相册状态、`draft_json`、V3 API 编排、Agent callback 合并、R2 presign |
| Agent | 识图分章、候选排版、缩略图评委、确定性排版兜底。当前已剥离编辑/主题/封面/finalize 等后续能力 |
| contracts | Web 和 Agent 共用的 Zod 契约、模板 JSON、生成类型和 fixtures |

## 仓库入口

```text
memoir-agent-rebuild/
├── README.md                    # 系统总框架
├── AGENTS.md / CLAUDE.md        # agent 起手约束
├── apps/
│   ├── web/README.md            # Web 内部结构、状态、API、运行命令
│   └── agent/README.md          # Agent 当前 route/flow/provider/测试
└── packages/contracts/          # 跨服务契约和模板
```

## 当前工作流

1. Browser 压缩照片,只发送生成所需的轻量图像数据和时间/聚类信号。
2. Web 创建 album/job/credit hold,调用 Agent `/v3/analyze`。
3. Agent 分章并回调 tree-only `V3LayoutTree`。
4. Web 进入采集/排版阶段, Browser 提供 200px refs。
5. Agent `/v3/select-layout` 生成候选结构并回调 `candidates`。
6. Browser 渲染候选缩略图,Web 调 Agent `/v3/judge-layout`。
7. Agent 选定候选并回调 `Page[]`。当前 pages 是版面结果,文案和后续编辑能力不在当前 Agent surface 内。

## 设计边界

- Web 是 album 和 job 状态的真相源;Agent 不推进 Web 的 `stage`。
- 原图由 Browser 持有;Web/Agent 不把 base64 落库、落 R2 或写日志。
- 跨服务字段先看 `packages/contracts/src/v3.ts`,Python 镜像在 `engine/src/schemas.py`。
- 模板 JSON 在 `packages/contracts/templates/*.json`;生成文件不要手改。
- 新增顶层目录、跨服务协议、数据库 schema、外部 API 或依赖前,先说明影响面。

## 本地命令

```bash
pnpm install
pnpm web:dev
pnpm agent:dev
pnpm typecheck
pnpm test
```

Agent 测试从仓根跑更稳:

```bash
PYTHONPATH=engine engine/.venv/bin/python -m pytest engine/tests
```

## 继续阅读

- Web: [`apps/web/README.md`](apps/web/README.md)
- Agent: [`engine/README.md`](engine/README.md)
- Contracts/templates: [`packages/contracts/templates/README.md`](packages/contracts/templates/README.md)
