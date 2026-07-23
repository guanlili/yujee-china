# Yujee(遇己)

AI 人生纪念册 Web 应用,面向海外市场。用户选择照片后进入编辑器,系统完成分章、排版、用户编辑和浏览器导出 PDF。

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
| Browser | 持有原图, 压缩/缓存照片, 读取 EXIF, 为 `/v3/select-layout` 和 `/v3/compose` 随请求带上 200px 缩略图 refs, 渲染编辑器, 本地生成 PDF 后直传 R2 |
| Web | 登录、支付、积分、相册状态、`draft_json`、V3 API 编排、Agent callback 合并、R2 presign |
| Agent | 确定性分章(零 AI)、确定性排版(一次出 pages)、一次性成稿 `/v3/compose`(全流程唯一的 AI 调用)。编辑/主题/封面/finalize 等后续能力不在当前 route surface |
| contracts | Web 和 Agent 共用的 Zod 契约、模板 JSON、生成类型和 fixtures |

## 仓库入口

```text
memoir-agent-rebuild/
├── README.md                    # 系统总框架
├── AGENTS.md / CLAUDE.md        # agent 起手约束
├── apps/
│   └── web/README.md            # Web 内部结构、状态、API、运行命令
├── engine/README.md             # Agent 当前 route/workflow/provider/测试
└── packages/contracts/          # 跨服务契约和模板
```

## 当前工作流

1. Browser 压缩照片,只发送生成所需的轻量图像数据和时间/聚类信号(EXIF 时间、GPS、
   本地聚类标签);原图不出浏览器。
2. Web 创建 album/job/credit hold,调用 Agent `POST /v3/analyze`。
3. Agent **纯确定性分组**(CLIP embedding / 拍摄时间 / GPS / 像素特征)+ 确定性归散图 +
   提取章节主色,回调 tree-only `V3LayoutTree`。章标题由拍摄时间跨度确定性派生,落在
   `V3Chapter.title`。**这一步零 AI 调用,也不识图。**
4. Web 进入 story 环节,用户逐章讲故事,答案写进 `chapterContext`。
5. 采访结束触发 `POST /v3/select-layout`:Agent 确定性选版(每 unit 一个播种候选),一次
   `completed` 回调直接回 `Page[]`,文案先填模板 JSON 自带的 `sample` 示例文案 ——
   用户看到的是有字的版面,不是空文字框。**零 AI 调用,没有候选/缩略图/评委来回。**
6. 用户在设计卡里选封面/封尾组合与书页底色(文字三色是确定性恒黑,不由模型决定)。
7. Web **异步派发**(`agent_jobs.kind='compose'`)`POST /v3/compose`(202 + callback):
   Agent 按章并发让 Gemini **看真实照片** + 读用户讲的故事写满全书文案,并出封面/封尾文案
   与字体(缺字体时 Web 侧确定性兜底);逐章发 progress 心跳。回调后 Web 组页落库并把
   `stage` 推到 `ready`。**这是全链路唯一的 AI 调用。**

后续编辑能力不在当前 Agent surface 内。Agent 对外只有四个端点:`GET /health`、
`POST /v3/analyze`、`POST /v3/select-layout`、`POST /v3/compose`。

## 设计边界

- Web 是 album 和 job 状态的真相源;Agent 不推进 Web 的 `stage`。
- 原图由 Browser 持有;Web/Agent 不把 base64 落库、落 R2 或写日志。
- 跨服务字段先看 `packages/contracts/src/v3.ts` 和 `packages/contracts/src/layout.ts`,
  Python 镜像在 `engine/src/contracts/schemas.py`。
- **页面真相 = HTML**:每页 draft 存完整 794×1123 HTML(`Page.html`),画板/PDF/设计对话
  都消费它;锚点契约 `data-text-key`/`data-image-slot`,图片 src 一律 `{{IMG_SRC:slotId}}`
  token(渲染时解析,base64 绝不落库)。槽位字段(templateId/images/texts)保留:photo
  引用、换排版重生成、装书校验的依据;texts 由 html 派生。渲染簇与 48 个 HTML 模板在
  `packages/contracts/src/render/`。
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

Web 测试**必须在 `apps/web` 目录下跑**(从仓根跑加载不到 `apps/web/.env`,真库集成测试
会假跳过):

```bash
cd apps/web && pnpm test
```

## 上线注意

- **Web 与 Agent 必须同版本部署。** 这一版是契约变更:删了 `/v3/judge-layout`、
  `/v3/judge-page-template`、`/v3/design` 三个端点,新增 `/v3/compose`,`V3Chapter` 加了
  `title`。只部署一边会当场契约漂移。Web 走 Vercel 自动部署,Agent 要**手动**
  `flyctl deploy`。
- **`flyctl deploy` 之前先确认 Fly 上 `yujee-agent` 有 `SELECT_LAYOUT_API_KEY`**
  (compose 的 Gemini key)。缺它时 `mode=real` 会 fail-fast 启动失败 —— 这是刻意的,
  详见 [`engine/README.md`](engine/README.md)。
- **数据库迁移 `0020` 要单独一批部署。** 它给 `agent_jobs.kind` 枚举加了 `'compose'`;
  PG 不允许在同一个事务里使用刚加的枚举值,而 drizzle 把待跑迁移放进同一个事务,
  所以将来任何引用 `'compose'` 的迁移都必须等 0020 跑完提交之后再跑。

## 继续阅读

- Web: [`apps/web/README.md`](apps/web/README.md)
- Agent: [`engine/README.md`](engine/README.md)
- Contracts/templates: [`packages/contracts/templates/README.md`](packages/contracts/templates/README.md)
