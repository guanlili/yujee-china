# Yujee(遇己)

AI 人生纪念册 Web 应用,面向海外市场。用户选择照片后进入编辑器,系统完成分章、排版、用户编辑和浏览器导出 PDF。

仓根 README 只放大的框架;各服务的内部实现分别看子目录 README。
设计文档和实施计划放 `docs/specs/` 与 `docs/plans/`(按 issue 归档,不再扩张成大 docs 树)。

## 系统框架

线上是**四个部署单元**:

```text
Browser
   |
   v
Web (Next.js, Vercel: yujee-web)
   |-- POST /v3/*  --> Agent        (FastAPI, Fly: yujee-agent)       生成主链路
   |                                    `-- 远程 CLIP (Fly: yujee-agent-clip)
   |-- POST /api/* --> Design Agent (Node,    Fly: yujee-design-agent) 对话式改书
   v
Postgres + Cloudflare R2
```

| 部分 | 主要职责 |
|---|---|
| Browser | 持有原图, 压缩/缓存照片, 读取 EXIF, 用浏览器 WebGL 引擎应用照片滤镜, 为 `/v3/select-layout` 和 `/v3/compose` 随请求带上 200px 缩略图 refs, 渲染编辑器, 本地生成 PDF 后直传 R2 |
| Web | 登录、支付、积分、相册状态、`draft_json`、`photo_filter`、V3 API 编排、Agent callback 合并、R2 presign |
| Agent | 确定性分章(零 AI)、确定性排版(一次出 pages)、一次性成稿 `/v3/compose`(生成链路唯一的 AI 调用) |
| Design Agent | 生成**之后**的对话式改书(七个写工具改文字/HTML/换版/换图/配色/字体/页序)。独立 base URL 与鉴权,**必须单机**(session 在进程内存) |
| contracts | Web 和 Agent 共用的 Zod 契约、模板 JSON、生成类型和 fixtures |

## 仓库入口

```text
memoir-agent-rebuild/
├── README.md                       # 系统总框架
├── CLAUDE.md                       # agent 起手约束(AGENTS.md 是指向它的符号链接)
├── docs/specs/ · docs/plans/       # 按 issue 归档的设计与实施计划
├── apps/
│   └── web/README.md               # Web 内部结构、状态、API、运行命令
├── engine/README.md                # 生成 Agent 的 route/workflow/provider/测试
└── packages/
    ├── contracts/                  # 跨服务契约和模板
    └── design-agent/README.md      # 对话式改书 Agent(部署约束见其 fly.toml)
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

生成 Agent 对外只有四个端点:`GET /health`、`POST /v3/analyze`、`POST /v3/select-layout`、
`POST /v3/compose`。**生成之后的编辑走另一条链路** —— 用户在编辑器里对话改书,由 Web 的
`/api/v3/albums/[uuid]/design-chat` 转给 Design Agent(`POST /api/book` + `POST /api/chat`),
与上面七步无关。别把它和生成链路混为一谈。

## 设计边界

- Web 是 album 和 job 状态的真相源;Agent 不推进 Web 的 `stage`。
- 原图由 Browser 持有;Web/Agent 不把 base64 落库、落 R2 或写日志。
- 照片滤镜状态落在 `albums.photo_filter`:一本书可设默认 LUT,每张照片可覆盖或显式回到原片,
  强度按 5% 量化。26 个确定性 LUT 以生成的 17³ 缩略资源和 33³ 完整资源随 Web 发布;
  `.cube` 源文件不进仓。滤镜只在浏览器处理派生图,IndexedDB 里的原图永不改写。
- 改滤镜会使现有 PDF/封面派生物失效。照片云快照按
  `photo-snapshots/{userId}/{albumId}/{photoId}/{renderVersion}.jpg` 保存不可变版本;
  新分享只冻结页面引用照片的精确当前版本,缺任一版本就以 409 拒绝创建。封面缩略图同样使用
  绑定滤镜状态、相册更新时间和第 0 页状态的不可变 revision key,签名后的旧状态不能确认覆盖。
- 跨服务字段先看 `packages/contracts/src/v3.ts` 和 `packages/contracts/src/layout.ts`,
  Python 镜像在 `engine/src/contracts/schemas.py`。
- **页面真相 = HTML**:每页 draft 存完整 794×1123 HTML(`Page.html`),画板/PDF/设计对话
  都消费它;锚点契约 `data-text-key`/`data-image-slot`,图片 src 一律 `{{IMG_SRC:slotId}}`
  token(渲染时解析,base64 绝不落库)。槽位字段(templateId/images/texts)保留:photo
  引用、换排版重生成、装书校验的依据;texts 由 html 派生。渲染簇与 47 个 HTML 模板在
  `packages/contracts/src/render/`(模板数以 `packages/contracts/templates/*.json` 为准,
  别在文档里手抄计数)。
- 模板 JSON 在 `packages/contracts/templates/*.json`;生成文件不要手改。
- 渲染注册表的**唯一真相**是 `apps/web/src/components/album/web-registry.ts`。
- 新增顶层目录、跨服务协议、数据库 schema、外部 API 或依赖前,先说明影响面。

## 本地命令

跑通全流程要起**三个**服务,少一个 design-chat 直接 502:

```bash
pnpm install
pnpm web:dev      # 3000
pnpm agent:dev    # 8001
pnpm design:album # 8787  ← 生产同款 album-server;漏了它 = design-chat 502
```

`design:album` 启动 `packages/design-agent/src/web/album-server.ts`,提供完整的
`/health`、`/api/book`、`/api/albums` 与 `/api/chat` surface。`design:dev` 启动的是
精简调试入口 `src/web/server.ts`,不能用于本地全流程联调。

验证:

```bash
pnpm typecheck    # 含 contracts + web,不含 engine
pnpm docs:check   # 文档时效(已挂进 typecheck)
pnpm test         # 见下方陷阱
```

Agent(Python)测试单独跑:

```bash
PYTHONPATH=engine engine/.venv/bin/python -m pytest engine/tests
```

Web 测试单跑:

```bash
cd apps/web && pnpm test        # 或 pnpm --filter @yujee/web test
```

### 验证陷阱

- 仓根 `pnpm test` 是 `pnpm -r test`,**撞到第一个失败的包就中断**,后面的包一个都不跑。
  看到红不代表只坏了那一处;看到绿要先确认 scope 覆盖了你改的包。
  要全量结论就逐包单独跑,别用它。
- `pnpm typecheck` **不含 engine**,改 Python 必须另跑 pytest。
- **design-agent 测试前必须先 `pnpm design:build`。** 它依赖 `packages/agent` /
  `packages/ai` 的 `dist/` 构建产物,新克隆或新 worktree 里没有。缺了会
  `ERR_MODULE_NOT_FOUND`,而且**整个测试文件加载失败、里面的用例根本不计数** ——
  实测未构建时报「96 tests」,构建后是「115 tests」,19 个用例静默消失了。
  测试总数比预期少要当心,那是文件没加载,不是用例变少。
- 没有 CI。所有验证都靠本地自觉执行 —— 别声称跑过没跑过的东西。

全量跑一遍(2026-07-25 实测 1483 个用例):

```bash
pnpm docs:check && pnpm typecheck
pnpm --filter @yujee/contracts test
pnpm --filter @yujee/web test
pnpm design:build && pnpm --filter @smalldog/design-agent test
pnpm --filter @earendil-works/pi-ai test
pnpm --filter @earendil-works/pi-agent-core test
PYTHONPATH=engine engine/.venv/bin/python -m pytest engine/tests -q
```

## 上线注意

- **Web 与 Agent 必须同版本部署。** 跨服务契约(`packages/contracts/src/v3.ts` 与
  `engine/src/contracts/schemas.py`)是**手工镜像,没有 codegen**,只部署一边会当场
  契约漂移。Web 走 Vercel 自动部署,Agent 要**手动** `flyctl deploy`。
- **Design Agent 也要手动部署,且必须保持单机**:
  `fly deploy -c packages/design-agent/fly.toml --dockerfile packages/design-agent/Dockerfile --ha=false .`
  session 在进程内存,扩到两台会掉正在进行的编辑会话。
- **`flyctl deploy` 之前先确认 Fly 上 `yujee-agent` 有 `SELECT_LAYOUT_API_KEY`**
  (compose 的 Gemini key)。缺它时 `mode=real` 会 fail-fast 启动失败 —— 这是刻意的,
  详见 [`engine/README.md`](engine/README.md)。
- **数据库迁移 `0020` 要单独一批部署。** 它给 `agent_jobs.kind` 枚举加了 `'compose'`;
  PG 不允许在同一个事务里使用刚加的枚举值,而 drizzle 把待跑迁移放进同一个事务,
  所以将来任何引用 `'compose'` 的迁移都必须等 0020 跑完提交之后再跑。

## 继续阅读

- Web: [`apps/web/README.md`](apps/web/README.md)
- 生成 Agent: [`engine/README.md`](engine/README.md)
- 设计 Agent: [`packages/design-agent/README.md`](packages/design-agent/README.md)
- Contracts/templates: [`packages/contracts/templates/README.md`](packages/contracts/templates/README.md)
- Agent 起手约束与文档时效规则: [`CLAUDE.md`](CLAUDE.md)

<!-- doc-scope
paths: engine/src/api/routes.py, apps/web/src/app/api/**, packages/design-agent/src/web/**, packages/contracts/templates/*.json, package.json, engine/fly*.toml, packages/design-agent/fly.toml
checked-at: 453f2f2d
-->
