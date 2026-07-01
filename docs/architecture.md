# Yujee 架构(入口文档)

> 这是项目的入口骨架。**不要在这份文档里塞细节**——所有规范、目录、协议、schema 都拆到了子文档里,按需加载。
>
> 阅读方法见根目录 `CLAUDE.md`。以代码现状为准(2026-06):五环节(原 V3)已落地为唯一形态,Agent 已重构成三真层 + 平铺边(见 [`docs/agent/design.md`](./agent/design.md))。

---

## 0. 产品基线

| 项 | 值 |
|---|---|
| 产品名 | Yujee(遇己)|
| 域名 | yujeeai.com |
| 形态 | AI 人生纪念册 Web 应用,海外市场,英文 UI |
| 用户路径(五环节)| 选照片 → 秒级进编辑器 → ① 分析(后台)→ ② 章节故事 → ③ 确定主题与章节色 → ④ 书籍设计 → ⑤ 待导出(浏览器出 PDF)|
| 初期容量目标 | 1000 用户(简单优先)|
| 长期容量目标 | 10 万用户(预留路径,但**第一版不实施**)|

> 「V3」是这套五环节架构的内部代号,也是端点命名空间(`/v3/*`)。**Agent 端只有 `/v3/*`(+ `/health`),v1/v2 整删**;**Web 端 `/api/v2/*` 与 v1 生成链路已删、`/api/v1/*` 基建端点(相册 CRUD/pages/PDF/积分/支付/auth/字体/admin)保留**。下文「V3」= 当前唯一形态。

---

## 1. 系统切分:三个组件

```
┌──────────────────────────┐      ┌──────────────────────────┐      ┌──────────────────────────┐
│         Browser          │      │     Web (Next.js 15)     │      │     Agent (FastAPI)      │
├──────────────────────────┤      ├──────────────────────────┤      ├──────────────────────────┤
│ 选照片 / 端内压缩 800px   │      │ 建相册 + ≤0.5s 跳编辑器   │      │ 不持 draft/stage          │
│ Stage0 读 EXIF 取 takenAt │      │ (分析任务后台异步跑)      │      │ 三真层 + 平铺边:          │
│ GPS只本地·坐标不出境      │ ───► │ 转发 base64,不落盘        │ ───► │  flows / agents / engine  │
│ 五环节 UI/面包屑/加载动画 │      │ 持 draft_json 树 + stage  │      │ 识图模型(版面主控)+      │
│ 章节故事交互组件          │ ◄─── │ (五环节状态唯一真相源)    │ ◄─── │ 文案模型 + 确定性引擎      │
│ 封面/封尾单独成页(画板)   │      │ 调度各环节对 Agent 调用   │      │ prompt/skill 分层        │
│ 本地渲染 PDF → 直传 R2    │      │ 积分:init 成功即按张扣    │      │ agent schema 记 edit-loop │
└──────────────────────────┘      └──────────────────────────┘      └──────────────────────────┘
                                              │
                                              ▼
                                   ┌──────────────────────────┐
                                   │  Postgres (Neon) · R2    │
                                   └──────────────────────────┘
```

### 1.1 三个组件的职责边界

**Browser**
- 唯一拥有原图的地方。原图永远不出浏览器。
- Canvas 压缩到 800px、quality 0.6 → base64 data URL 作为「特征载体」。
- **Stage 0 读 EXIF**:取 `takenAt`(排序/分章用)随 base64 发出。GPS **只在浏览器本地用**:派生不透明 `clusterId`(同址同时标签,非坐标,#232),以及**反地理编码成城市级地名字符串**供内容采集预填(§3 隐私:坐标止步浏览器,只地名文字出境)。
- 用 React 模板渲染**五环节 UI**:顶栏面包屑(分析 > 章节故事 > 确定主题 > 书籍设计 > 待导出)、分析期加载动画、章节故事交互组件(对话 + 缩略图条)、画板把封面/封尾单独成页。
- 交互时把当前 layout 切片 + 用户消息发给 Web(非全树)。
- 导出 → 浏览器本地用 `@react-pdf/renderer` 生成 PDF → presigned 直传 R2(失败重试 ≤3 次)。

**Web (Next.js)**
- 唯一与用户、数据库、支付打交道的组件;唯一持久状态真相源。
- **建相册 + 秒级跳编辑器**:`/v3/analyze` 后台异步跑,不阻塞进入。
- 收到 base64 **不落盘、不存 R2、不写日志**,直接转发 Agent。
- **持 `draft_json`(authoring 树 + pages + progress)+ `albums.stage`**:`stage` 是五环节状态的**唯一真相源**(Agent 不持 stage)。
- **调度各环节对 Agent 的调用**:转发切片、合并 Agent 回的 patch/tree 写回 `draft_json`、推进 `stage`、控导出闸门(章节故事全完成才解锁)。
- **积分扣费**:init 成功即按张实扣(`⌈张数/10⌉`),失败 `release`;其余环节免费。
- 编排路由见 §2 端点表与 [`docs/agent/contract.md §3.2`](./agent/contract.md)。

**Agent (FastAPI)** —— 不持 `draft_json` / stage / public album 数据;仅 Stage3 edit-loop 状态写同一 Postgres 的独立 `agent` schema(Alembic)。内部 = **三真层 + 平铺边**(详见 [`design.md`](./agent/design.md)):
- **transport**(`routes.py` + `errors.py` + `callback.py`):`/v3/*` 端点,瘦——解析 → 调 flow/agent/engine → 套信封;`errors.py` 统一同步端点错误映射。
- **flows**(`flows/analyze.py`):唯一真多步编排(describe→group→template→preview + 回调),无状态。
- **agents**(`agents/<cap>/`):LLM 能力,每个 = `handler.py` + 共置 prompt `.md`(+ 需要时 `schema.py`)。共置 `.md` 只写角色、输入范围、输出 JSON/字段契约和硬格式要求;不放人为规则。
- **engine**(`engine/`):确定性引擎,不调模型——`templates` / `skeleton`(挑模板+排图)/ `generic_copy` / `apply_theme` / `cover` / `finalize`(拍平 + 单一 validate)。
- **agent DB boundary**(`db.py` + `migrations/`):只拥有 `agent.edit_sessions` / `agent.edit_messages` / `agent.edit_ops`;`DATABASE_URL` 必须指向同一 Postgres,Web Drizzle 不管理该 schema。
- **平铺边**:`ai_client.py`(HTTP/JSON/usage)+ `vision_provider.py`(provider/failover/超时)= 模型适配;`schemas.py` = 契约镜像;`main/settings/auth/logging`。
- **skills**(`skills/`):分层组装——`agents/<cap>/*.md`(固定 agent 契约)+ `skills/*.md`(人为可调规则、风格、红线、兜底回复,handler 用 `skills=` 或 `SKILLS_DIR` 显式加载)。

**承载的模型(provider 槽可配):**
- **识图模型 = 版面主控**:火山 doubao-vision(`ARK_*` 槽,默认 `doubao-seed-1-6-vision`)/ OpenAI GPT(`OPENAI_*` 槽,`gpt-5.5-mini`),两槽**互为 failover**。既做图片分析,又主控一切改变版面观感的判断(分章/套模板/主题/章节色/改图意图)。
- **文案模型**:DeepSeek 槽(`DEEPSEEK_*`,默认 `deepseek-chat`,可配其它兼容模型)——章节文案 + 章节对话分诊(talk/写/改)。
- **确定性引擎**:分组 / 套模板 / 刷主题 / 封面 / flatten / 校验,无 LLM。

### 1.2 为什么这样切

1. **图片不落盘** —— 用户隐私是核心承诺。Web 和 Agent 都不存原图。
2. **Web 不做 AI** —— Next.js serverless 不适合长任务和大依赖。
3. **Agent 不碰 Web 公共用户数据** —— 只通过请求/内部回调看到必要 base64 和文本;不直连读写 `public.albums`。Stage3 仅在 `agent` schema 记录 edit-loop 会话/消息/op 状态;挂掉不影响登录/支付/已有作品。
4. **PDF 在浏览器生成** —— 原图始终在本地;Web 只签 URL,不接 PDF 流量。

---

## 2. Web ↔ Agent 协议(骨架)

> 详细 req/res、错误码、状态机 → [`docs/agent/contract.md`](./agent/contract.md);Agent 内部分层、pipeline、failover、redact → [`docs/agent/design.md`](./agent/design.md)。

Agent 暴露**两个异步端点 + 七个同步/内部端点**,均 Bearer 鉴权(`AGENT_SHARED_SECRET`),只被 Web 调用、不被浏览器直调。

### 2.1 初始化 — `POST /v3/analyze` + `POST /v3/select-layout`(异步)
- **为什么异步**:多图识图和批量选模板都可能耗时;支撑「点下一个 ≤0.5s 进编辑器 + 后台分析/排版」。
- `/v3/analyze` 接单即 `202`,后台跑(`flows/analyze.py`),回推 `POST /api/v3/internal/job-progress`(`progress`/`completed`/`failed`)。
- **入参**:base64 + EXIF(只 `takenAt`)+ 可选 `clusterId`。(地名不走 analyze —— 它经分组后的内容采集进 `chapterContext`,见 §2.1a。)
- **出参(回调)**:tree-only `V3LayoutTree`;不返回 pages。
- `/v3/select-layout` 接收 Stage1 tree + 浏览器保留的 200px refs,后台跑(`flows/select_layout.py`),回推同一个 `job-progress` sink。
- **出参(回调)**:`Page[]` + usage;Web 合并 tree/pages 后推进到 `story`。
- **P2 排版评委(浏览器渲真缩略图)**:为让 Gemini 评委看**真实排版**而非线框,`/v3/select-layout` 拆成**两段异步、浏览器驱动**:phase 1 Agent 生成候选 → 回调 `candidates`;浏览器用现成 React 模板**只渲图槽(无文字/无字体)**出小缩略图;phase 2 浏览器把缩略图 POST `/v3/judge-layout` → Agent 调 Gemini 评委选赢家 → 同一 `completed` 回调返回 pages。候选生成与评委 LLM 都留 Agent(不破「Web 不调 LLM」),渲染留浏览器(只有它有照片像素,且不触 Google Fonts)。详见 [`contract.md §5.2.1`](./agent/contract.md)。
- 浏览器轮询相册状态,不开 SSE(理由见 2.3)。

### 2.1a 内容采集(分组后采访)— `POST /api/v3/albums/[uuid]/chapter-context`(纯 Web 写回)

分组(analyze)完成后、排版前,插一个**内容采集**环节:让用户按章讲一次这组照片的背景(时间/地点/人/事/心情),把它喂给排版和写文案,一次排到位,减少事后逐页返工。

- **纯 Web 交互,不经 Agent**:采访在浏览器对话框里进行(模仿 AI 发三条短消息引导用户答一段文字)。答案由 Web 写进 `draft_json.tree` 的 `V3Chapter.chapterContext`(**树字段**,非页级),不调 Agent、不推进 `stage`。
- **端点**:`POST /api/v3/albums/[uuid]/chapter-context`,body `{contexts: [{chapterId, chapterContext}]}`;service `saveChapterContexts` 校验章存在/不重复、裁 500、写回。**可跳过**:未提交的章 `chapterContext` 保持 `""`(default),不挡排版。
- **预填(时间/地点)**:采访在 analyze 回来后弹,但地名/时间必须在**提交照片时**(坐标还在浏览器)按 `clusterId` 预算好缓存 —— analyze 一返回坐标即随聚类丢弃。采访时拿章里任一 `photoId` 反查 `clusterId`(章不跨 cluster,#232)取预填。地名由浏览器**本地反地理编码**得到城市级字符串,拼成「时间:… 地点:…」前缀 + 用户原话 → `chapterContext`。**坐标不出浏览器**(§3)。
- **下游**:`chapterContext` 随 `V3Chapter` 流进 `/v3/select-layout`(评委据它选贴合基调的版式)与 `/v3/edit-chat` 写文案(当第一手素材);`finalize` flatten 后不再需要,不进扁平契约。

### 2.2 其余环节 — 同步/内部端点(秒级,前端转圈)

| 环节 | 端点 | 模型 |
|---|---|---|
| 章节故事(主路径) | `POST /v3/edit-chat` | **控制器 AI(controller agent loop,§7.12)**:强函数调用模型(默认识图槽 ark `doubao-seed-1-6` / failover openai `gpt-5.5-mini`)单请求内多步用工具;edit_text/swap_images 仍可下挂文案/识图模型 |
| 章节故事(无状态能力面) | `POST /v3/chapter-chat` | 文案模型 |
| 编辑确认回执 | `POST /internal/agent-ack` | 无(Agent DB 状态推进)|
| 主题/章节色 · 推荐 | `POST /v3/recommend` | 文案模型输出 3 组 bookThemeOptions |
| 主题/章节色 · 应用 | `POST /v3/apply-theme` | 无(确定性)|
| 书籍设计(封面/封尾)| `POST /v3/cover` | 无(确定性)|
| 待导出 | `POST /v3/finalize` | 无(确定性 flatten + 单一 validate)|

- 均**同步 HTTP**,纯变换「输入切片 → 输出补丁」,可重试、可水平扩展。
- **`stage` 推进权在 Web**:Agent 不持 stage;Web 合并补丁、记 stage、控导出闸门。
- 允许封面环节从 `theme` 直接跳 `ready`(跳过 cover)。
- layout 树**按需切片传**(②传单章;③④传相关页),全树只在 ⑤ finalize 传一次。

### 2.3 共通
- **超时**:接单 5s;同步端点 60s;Agent → 外部模型 30s 重试 1 次;Agent → Web callback 短超时重试。
- **失败语义**:异步走回调 `failed`(带 stage);同步走 HTTP 错误码;前端可重试,不污染 `stage`。
- **为什么不用 SSE**:Vercel 多 lambda 实例,进程内 EventEmitter 无法跨实例;轮询零依赖、Vercel 上必然工作,1000 用户够用。

**Web 侧编排路由**:`POST /api/v3/albums`(建册+扣费+派 analyze/select-layout)、`/api/v3/internal/job-progress`(回调 sink)、`albums/:id/{draft,story-progress,chapter-chat,recommend,apply-theme,cover,finalize,retry}`。

---

## 3. 不变式(违反 = bug)

> 施工反复对照的重点只有两类:**① Server 端数据归属**、**② 积分数据变更**。其余是边界红线。

**① 数据归属(重点)**
1. **Web 是 album 真相源**:持 `draft_json`(树 + pages + progress)+ `albums.stage`;Agent 不持 draft/stage/album public 数据。Stage3 edit-loop 的会话/消息/op 状态例外归 Agent 自有 `agent` schema,只服务 pending/committed ack 与 history,不存原图/base64/draft_json。**Stage3 控制器 AI(§7.12)在这条不变式之下**:它每轮**现取**(`get_page_info`/`get_book_tree`)当前 draft 切片、循环结束把 patch 回 Web 落库,从不把 draft 持久化进 `agent.*`;一条用户消息 = 一个 serialized turn,内部多步工具调用最终落**一份** pending op + opId,ack 契约不变。
2. **分层归属**:Service 方法第一参数 `userId` / `actor`;Route 只编排、不 import drizzle;Service 不跨用别的 service 的 repo。
3. **authoring 树边界**:`draft_json` + 交互期请求体**永不进渲染 / PDF / 对外契约**;`finalize` 拍平成扁平 `AlbumLayoutPlan`(章节色/字体烘进扁平页,渲染契约不加树形字段)才落 `album_pages`。

**② 积分变更(重点)**
4. 积分变更在 DB 事务里、与 album 状态变更**原子**;**init 成功即按张实扣**(`⌈张数/10⌉`)、失败 `release`、成功只扣一次、重试不重复。

**边界红线**
5. **隐私**:原图与 base64 只在「浏览器 → Agent」内存链路过,**不入库 / R2 / 日志**;**坐标(lat/lng/经纬度)止步浏览器,绝不出境、不入库、不入日志**(redact 仍拦坐标键作防御);PDF 浏览器生成 + presigned 上传。
   - **地名文字可出境(内容采集,分组后采访)**:浏览器可把 EXIF GPS **在本地反地理编码成城市级地名字符串**(如「杭州」),用于采访预填与 `chapterContext`。**只有地名字符串出境,坐标本身不出浏览器** —— 反查在浏览器内完成(见 `apps/web/src/lib/photo/geocode.ts`),lat/lng 不进请求体 / draft_json / 日志。地名一律作**普通文字**流转(拼进 `V3Chapter.chapterContext`),不设结构化 location/place/坐标字段。
   - **clusterId 例外(#232)**:每张照片可带不透明 `clusterId`(`c1`/`c2`/…),浏览器本地从 EXIF 时间/GPS 派生,只表达「同址同时」,**绝不含坐标/经纬度**;算不出 → null,Agent 退化为单批行为(向后兼容)。
   - **仍严禁**:结构化 location / place / GPS / lat / lng / 坐标字段进任何契约/树/页(契约 `.strict()` + redact 继续拦)。放开的**仅是地名字符串**这一层,且必须由浏览器反查后以文字形式携带。
6. Agent 输出 layout 写库前必 **zod 校验**;`AGENT_SHARED_SECRET` 不进任何 client bundle。

---

## 4. 项目目录(顶层)

```
memoir-agent-rebuild/
├── apps/
│   ├── web/                       # Next.js 15 + Drizzle + better-auth → docs/web/*
│   │   ├── src/app/api/v3/*       #   V3 编排路由
│   │   ├── src/services/*         #   album / job / generation 等 service
│   │   ├── src/db/schema.ts       #   Drizzle schema(albums.stage / draft_json / agent_jobs)
│   │   ├── fonts/                 #   Noto SC TTF(server-only,PDF subset 源)
│   │   └── design-v1/             #   V1 UI 实现稿(视觉/token/i18n 真相源,不参与构建)
│   └── agent/                     # FastAPI 服务 → docs/agent/*
│       └── src/                   #   三真层 + 平铺边:
│           ├── routes.py · errors.py · callback.py    # transport(HTTP 边)
│           ├── flows/             #     编排(analyze)
│           ├── agents/<cap>/      #     LLM 能力三件套(handler + contract *.md [+ schema])
│           ├── engine/            #     确定性引擎(templates/skeleton/.../finalize)
│           ├── skills/            #     人为规则/风格/红线/回复 + 加载器
│           ├── ai_client.py · vision_provider.py      # model 适配
│           └── schemas.py · main · settings · auth · logging
├── packages/
│   └── contracts/src/             # 跨服务单一真相源:v3.ts · layout.ts · theme-carrier.ts
│       └── templates*.ts          #   模板契约;templates/ 下 JSON = 模板真相源
├── docs/                          # 所有架构文档
└── CLAUDE.md                      # 工程入口,所有 agent 必读
```

**目录扩张规则**:新增顶层目录、或在 `apps/web/src` / `apps/agent/src` 下加顶层目录,**必须先由架构师在本文件登记**,再让工程师建。

详细到文件级 → [`docs/web/directory.md`](./web/directory.md)、[`docs/agent/design.md`](./agent/design.md)。

---

## 5. 部署

| 服务 | 平台 | 备注 |
|---|---|---|
| Web | Vercel | yujeeai.com;`next.config.mjs` + `vercel.json` |
| Agent | Fly.io | app `yujee-agent`,region `nrt`,内部端口 `8001`;`AGENT_PIPELINE_MODE=real` |
| Postgres | Neon | Web Drizzle 管 public schema(`apps/web/src/db/migrations`);Agent Alembic 管独立 `agent` schema(`apps/agent/migrations`,需 `DATABASE_URL`) |
| R2 / CDN | Cloudflare | PDF presigned 上传 |

环境变量完整清单 → 见各子文档结尾。本地起服务:Agent `pnpm agent:dev`(读 `apps/agent/.env`);若 `8001` 已被旧进程占用,用 `PORT=8011 pnpm agent:dev`;Web `next dev`(用 nvm node,见记忆)。

---

## 6. 扩展到 10 万用户的路径(未来,**第一版不实施**)

| 阈值 | 行动 |
|---|---|
| Agent QPS > 5 | 加 Redis 队列 + Python worker |
| 浏览器轮询 QPS > 200 | 上 SSE/WebSocket(Upstash Redis pubsub 跨实例广播)|
| Postgres 写 > 100 QPS | `albums` / `agent_jobs` 加分表或归档 |
| 单次生成成本 > $0.20 | 结果缓存(按 prompt + photo hashes 命中)|

第一版**不留任何抽象**给这些扩展。YAGNI。

---

## 7. 已落地的关键架构决策(沿革)

> 这些是已**实施完成**的决策(非待办)。早期「V3 拍板」的迁移细节已落地,这里只留仍然成立的结论。

1. **Agent 端点全 `/v3/*`**:2 个异步初始化端点(`/v3/analyze`, `/v3/select-layout`) + 7 个同步/内部端点(`/v3/edit-chat`, `/v3/chapter-chat`, `/v3/page-edit`, `/v3/recommend`, `/v3/apply-theme`, `/v3/cover`, `/v3/finalize`, `/internal/agent-ack`) + `/health`;Agent 的 v1/v2 整删,无兼容层。Web 端 `/api/v2/*` 与 v1 生成链路(`/v1/layout` 等)已删,**`/api/v1/*` 基建端点保留**(相册 CRUD、pages、PDF presigned、字体 subset、积分/Creem webhook、auth、admin、job 轮询)。
2. **两类模型 + 识图模型当主控**:识图模型(ark/openai 双槽 failover)既分析又主控版面;文案模型(deepseek 槽)只管文案;详见 §1.1。
3. **隐私:Stage 0 读 `takenAt`;GPS 只在浏览器本地用(派生 `clusterId` + 反查地名字符串),坐标不出境**;分章只用时间 + `clusterId` + 画面整体性;地名文字经内容采集进 `chapterContext`(§3);redact 保留坐标键作防御红线。
4. **`albums.stage`(五环节状态主控)**:`album_stage` pgEnum = `('analysing','story','theme','cover','ready')`,Web 唯一真相源,与 `albums.status`(init 生命周期 + 积分)**正交并存、互不派生**。导出闸门 = 章节故事全章完成即解锁,主题/封面不卡导出。
5. **契约单一真相源:TS 先行,Python 镜像**:`packages/contracts`(zod)是真相源,Agent `schemas.py` 逐字段镜像(`.strict()` / `extra='forbid'`)。
6. **模板契约标准化**:模板 JSON = `category | pairing | images | svgs | texts | items | variableDecor`;旧 `slot+scene` / `quality`/`orientation` 硬约束已废,排图由 `template_select` 出意图 + 引擎在合法候选兜底(横竖比错配交 center-cover 渲染)。
7. **校验单一真相源**:finalize 单一 `validate_v3`(认 svgs/items/variableDecor/章节色/字体);无 page0-必须-cover 规则(封面可选可跳)。
8. **Agent 三真层重构(2026-06,PR #240)**:扁平 `services/` → `flows / agents / engine` + 平铺边 + `skills` 分层;删历史孤儿(tools.py / layout_rules 等)+ 消状态泄漏;行为零变更(契约/不变式不动)。详见 [`design.md`](./agent/design.md)。
9. **planner(未来 · 第二期)**:自然语言指令 → 自主规划调用 agents/engine 工具面;坐在现在这套无状态分层之上(stateful 仅一条指令内)。当前是 planner-ready 地基,尚未实现。
10. **中途加图**:main 上**尚未实现**;目标设计 = Web 侧可重入派生闸(分析新批次 + 合并不覆盖 + 按章补完,新章未完成则导出闸自动重关)。
11. **排版评委看真实渲染缩略图(P2,两段式 select-layout)**:Stage2 排版评委从「结构 JSON + 裸照片 + 模板线框图」升级为看**真实排好版的候选缩略图**。三方分工硬约束:**候选生成在 Agent**(`candidate_gen_v3`,不复制引擎逻辑)、**渲染在浏览器**(现成 React 模板,只渲图槽、跳过所有文字与字体,DOM→canvas→下采样 JPEG;只有浏览器有照片像素且不触本地被墙的 Google Fonts)、**评委 LLM 在 Agent**(Gemini `judge_layout`)。
    - **流程(浏览器驱动,沿用同 `requestId`)**:`/v3/select-layout`(phase 1,Agent 生成候选→回调 `candidates`)→ 浏览器只渲图槽出缩略图(longest edge ~320px / JPEG q~0.6 / 目标 ≤~30KB·张)→ `/v3/judge-layout`(phase 2,浏览器 POST 缩略图,Agent Gemini 评委选赢家→`completed` 回调返回 `Page[]`)。
    - **为什么这样切**:Agent 不可同步回调 Web(不变式),所以渲染这一步必须由浏览器在两次异步之间承接,等于把既有「browser-driven select-layout」延长一跳;**未新增任何 Agent→Web 同步调用,Web 仍不调 LLM**。
    - **降级**:任一候选渲染失败 / 无 canvas / Gemini 不可用(本地 geo-block)→ 逐 unit 退化「取候选 0」,确定性 skeleton 仍是最终兜底;不阻塞 `stage` 推进。`/v3/select-layout` 可由开关回到单段内联评委(线框图)模式向后兼容。

12. **Stage3 编辑 = 控制器 AI agent loop(2026-06,取代单发 tool router)**:`/v3/edit-chat` 的旧实现是**单发 tool 路由**——LLM 一次只挑一个工具、执行后直接返回,工具结果**不回喂**给模型,且 payload **不带聚焦页当前文案**(根因:"change to English does nothing" —— AI 蒙眼)。新实现把它换成**一个主控制器 AI**:持全上下文、知道自己的能力面与边界,在**同一个同步请求内自主多步用工具**(看页 → 决策 → 改 → 校验 → 收尾),循环到模型不再发 tool_call 或触发迭代/预算护栏才返回最终 patch + reply。
    - **模型**:控制器跑在**识图槽**(`vision_provider`:默认 ark `doubao-seed-1-6`,failover openai `gpt-5.5-mini`)—— 这两槽是仓里唯一既支持 OpenAI 风格 `tools`/`tool_calls` 多步函数调用、又有 reasoning 的强模型;DeepSeek/doubao-lite 文案槽留给被控制器**调用**的子能力(写文案、判图意图),不当主控。`ai_client.chat_completion` 已转发 `tools`/`tool_choice`,无需新基建。控制器温度低(~0.2)、`tool_choice="auto"`。
    - **工具面**:读工具 `get_page_info` / `get_book_tree`(已存在,现在结果**回喂**给模型);改工具 `edit_text`(**新干净工具**,把今天埋在 page-edit 里的 `edit_text.md` 逻辑提成可组合工具,**必须收 + 返当前 texts**)、`swap_layout` / `swap_images` / `advance_book` / `confirm_chapter`。语言("change to English")由控制器从 user goal + 当前 texts **推断**进 `edit_text`,不另立语言参数。
    - **护栏(同步 in-request)**:max 工具迭代 6 步、整轮 `asyncio.wait_for` < 58s(对齐 §2.3 同步 60s);超护栏即用已成功的 patch + 保守 reply 收尾,绝不挂住 HTTP。控制器不可用(缺 key / 4xx / 超时)→ 降级回旧的保守 talk 行为,草稿零改动。
    - **不破不变式**:Agent 仍不持 draft(经 `get_page_info`/`get_book_tree` 现取、patch 回 Web 落库);edit-loop 会话/消息/op 状态仍只在 `agent.*`(一条用户消息 = 一个 serialized turn,内部多步循环,最终一份 `create_pending_turn` + opId ack 往返,serialized-turn 契约不变)。`/v3/edit-chat` 请求/响应**外形不变**(循环全在内部);`patches`/`pagesTexts`/`progressDecision`/`navigation`/`opId` 语义照旧。
    - **page-edit / case4-swap 不动**:`/v3/page-edit`(两段式 helper)与 `tools/layout.py` 的 case4 确定性换版是独立路径,保留;控制器仅取代 edit-chat 的 `_run_tool_router`。详见 [`contract.md §6.2`](./agent/contract.md)。

---

## 8. 怎么读这份文档系列

不要从头到尾读 `docs/`。按角色加载:

1. **任何任务开始前** → 读 `CLAUDE.md`(根目录)
2. 在 `CLAUDE.md` 找你的**角色行**,看起手必读清单
3. 按清单**一份一份读**
4. 过程中遇到清单外细节(字段、错误码、协议)→ 按需查子文档

> Agent 内部结构以 [`docs/agent/design.md`](./agent/design.md) 为准。
>
> 完整角色→文档映射在 `CLAUDE.md`。
