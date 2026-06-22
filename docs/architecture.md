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
│ 选照片 / 端内压缩 800px   │      │ 建相册 + ≤0.5s 跳编辑器   │      │ 无状态,不存任何数据       │
│ Stage0 读 EXIF 取 takenAt │      │ (分析任务后台异步跑)      │      │ 三真层 + 平铺边:          │
│ 不抽 GPS · 无地点维度     │ ───► │ 转发 base64,不落盘        │ ───► │  flows / agents / engine  │
│ 五环节 UI/面包屑/加载动画 │      │ 持 draft_json 树 + stage  │      │ 识图模型(版面主控)+      │
│ 章节故事交互组件          │ ◄─── │ (五环节状态唯一真相源)    │ ◄─── │ 文案模型 + 确定性引擎      │
│ 封面/封尾单独成页(画板)   │      │ 调度各环节对 Agent 调用   │      │ prompt 分层(common/rules)│
│ 本地渲染 PDF → 直传 R2    │      │ 积分:init 成功即按张扣    │      │ 调用间无状态,无副作用     │
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
- **Stage 0 读 EXIF**:只取 `takenAt`(排序/分章用)随 base64 发出;**不抽 GPS、不做地点反查**(§3 隐私)。可附一个不透明 `clusterId`(同址同时标签,非坐标,#232)。
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

**Agent (FastAPI)** —— 无状态、无 DB、无文件持久化。内部 = **三真层 + 平铺边**(详见 [`design.md`](./agent/design.md)):
- **transport**(`routes.py` + `errors.py` + `callback.py`):6 个端点,瘦——解析 → 调 flow/agent/engine → 套信封;`errors.py` 统一同步端点错误映射。
- **flows**(`flows/analyze.py`):唯一真多步编排(describe→group→template→preview + 回调),无状态。
- **agents**(`agents/<cap>/`):5 个 LLM 能力,每个 = `handler.py` + 共置 prompt `.md`(+ 需要时 `schema.py`):`image_understanding`(识图分章)、`writing`(章节文案/对话)、`theme_recommend`(主题/章节色)、`template_select`(挑模板)、`image_edit_intent`(改图意图)。
- **engine**(`engine/`):确定性引擎,不调模型——`templates` / `skeleton`(挑模板+排图)/ `generic_copy` / `apply_theme` / `cover` / `finalize`(拍平 + 单一 validate)。
- **平铺边**:`ai_client.py`(HTTP/JSON/usage)+ `vision_provider.py`(provider/failover/超时)= 模型适配;`schemas.py` = 契约镜像;`main/settings/auth/logging`。
- **prompts**(`prompts/`):分层组装——`agents/<cap>/*.md`(固定结构:任务 + JSON 形状)+ `common/`(跨能力红线:`json_only`/`grounding`/`privacy`/`persona`,handler 用 `common=` 声明)+ `rules/`(按能力可调规则:分章/写作·引导风格/颜色字体,`RULES_DIR` 加载)。

**承载的模型(provider 槽可配):**
- **识图模型 = 版面主控**:火山 doubao-vision(`ARK_*` 槽,默认 `doubao-seed-1-6-vision`)/ OpenAI GPT(`OPENAI_*` 槽,`gpt-5.5-mini`),两槽**互为 failover**。既做图片分析,又主控一切改变版面观感的判断(分章/套模板/主题/章节色/改图意图)。
- **文案模型**:DeepSeek 槽(`DEEPSEEK_*`,默认 `deepseek-chat`,可配其它兼容模型)——章节文案 + 章节对话分诊(talk/写/改)。
- **确定性引擎**:分组 / 套模板 / 刷主题 / 封面 / flatten / 校验,无 LLM。

### 1.2 为什么这样切

1. **图片不落盘** —— 用户隐私是核心承诺。Web 和 Agent 都不存原图。
2. **Web 不做 AI** —— Next.js serverless 不适合长任务和大依赖。
3. **Agent 不碰用户数据** —— 只看到 base64 和文本,调用间无状态;挂掉只影响生成,不影响登录/支付/已有作品,也好水平扩展。
4. **PDF 在浏览器生成** —— 原图始终在本地;Web 只签 URL,不接 PDF 流量。

---

## 2. Web ↔ Agent 协议(骨架)

> 详细 req/res、错误码、状态机 → [`docs/agent/contract.md`](./agent/contract.md);Agent 内部分层、pipeline、failover、redact → [`docs/agent/design.md`](./agent/design.md)。

Agent 暴露**一个异步端点 + 五个同步端点**,均 Bearer 鉴权(`AGENT_SHARED_SECRET`),只被 Web 调用、不被浏览器直调。

### 2.1 分析 — `POST /v3/analyze`(异步,唯一异步端点)
- **为什么异步**:多图识图 1–2 min;支撑「点下一个 ≤0.5s 进编辑器 + 后台分析」。
- Agent 接单即 `202`,后台跑(`flows/analyze.py`),回推 `POST /api/v3/internal/job-progress`(`progress`/`completed`/`failed`)。
- **入参**:base64 + EXIF(只 `takenAt`,无地点)+ 可选 `clusterId`。
- **出参(回调)**:套模板 + 通用文案/通用色的**预览态 layout 树** + pages。
- 浏览器轮询相册状态,不开 SSE(理由见 2.3)。

### 2.2 其余四环节 — 同步端点(秒级,前端转圈)

| 环节 | 端点 | 模型 |
|---|---|---|
| 章节故事 | `POST /v3/chapter-chat` | 文案模型(改图时升级识图模型出意图)|
| 主题/章节色 · 推荐 | `POST /v3/recommend` | 识图模型 |
| 主题/章节色 · 应用 | `POST /v3/apply-theme` | 无(确定性)|
| 书籍设计(封面/封尾)| `POST /v3/cover` | 无(确定性)|
| 待导出 | `POST /v3/finalize` | 无(确定性 flatten + 单一 validate)|

- 均**同步 HTTP**,纯变换「输入切片 → 输出补丁」,可重试、可水平扩展。
- **`stage` 推进权在 Web**:Agent 无状态;Web 合并补丁、记 stage、控导出闸门。
- 允许封面环节从 `theme` 直接跳 `ready`(跳过 cover)。
- layout 树**按需切片传**(②传单章;③④传相关页),全树只在 ⑤ finalize 传一次。

### 2.3 共通
- **超时**:接单 5s;同步端点 60s;Agent → 外部模型 30s 重试 1 次;Agent → Web callback 短超时重试。
- **失败语义**:异步走回调 `failed`(带 stage);同步走 HTTP 错误码;前端可重试,不污染 `stage`。
- **为什么不用 SSE**:Vercel 多 lambda 实例,进程内 EventEmitter 无法跨实例;轮询零依赖、Vercel 上必然工作,1000 用户够用。

**Web 侧编排路由**:`POST /api/v3/albums`(建册+扣费+派 analyze)、`/api/v3/internal/job-progress`(回调 sink)、`albums/:id/{draft,story-progress,chapter-chat,recommend,apply-theme,cover,finalize,retry}`。

---

## 3. 不变式(违反 = bug)

> 施工反复对照的重点只有两类:**① Server 端数据归属**、**② 积分数据变更**。其余是边界红线。

**① 数据归属(重点)**
1. **Web 是唯一真相源**:持 `draft_json`(树 + pages + progress)+ `albums.stage`;**Agent 无持久状态**(无 DB / FS / 会话),每次收完整上下文、回补丁——同步端点纯函数可水平扩展,异步 analyze 仅进程内瞬态(per-job holder,无模块全局)。
2. **分层归属**:Service 方法第一参数 `userId` / `actor`;Route 只编排、不 import drizzle;Service 不跨用别的 service 的 repo。
3. **authoring 树边界**:`draft_json` + 交互期请求体**永不进渲染 / PDF / 对外契约**;`finalize` 拍平成扁平 `AlbumLayoutPlan`(章节色/字体烘进扁平页,渲染契约不加树形字段)才落 `album_pages`。

**② 积分变更(重点)**
4. 积分变更在 DB 事务里、与 album 状态变更**原子**;**init 成功即按张实扣**(`⌈张数/10⌉`)、失败 `release`、成功只扣一次、重试不重复。

**边界红线**
5. **隐私**:原图与 base64 只在「浏览器 → Agent」内存链路过,**不入库 / R2 / 日志**;**不抽 GPS、无地点/坐标字段**(redact 仍拦坐标键作防御);PDF 浏览器生成 + presigned 上传。
   - **clusterId 例外(#232)**:每张照片可带不透明 `clusterId`(`c1`/`c2`/…),浏览器本地从 EXIF 时间/GPS 派生,只表达「同址同时」,**绝不含坐标/经纬度/地名**;算不出 → null,Agent 退化为单批行为(向后兼容)。**仍严禁** location / place / GPS / 坐标任何真实位置字段(契约 `.strict()` + redact 继续拦)。
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
│           ├── agents/<cap>/      #     LLM 能力三件套(handler + *.md [+ schema])
│           ├── engine/            #     确定性引擎(templates/skeleton/.../finalize)
│           ├── prompts/           #     common/(红线)+ rules/(可调规则)+ 加载器
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
| Postgres | Neon | Drizzle migrations 在 `apps/web/src/db/migrations`(stage 列由 `album_stage` enum 回填) |
| R2 / CDN | Cloudflare | PDF presigned 上传 |

环境变量完整清单 → 见各子文档结尾。本地起服务:Agent `cd apps/agent && .venv/bin/uvicorn src.main:app --port 8001`(读 `.env`);Web `next dev`(用 nvm node,见记忆)。

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

1. **Agent 端点全 `/v3/*`**:1 异步 `/v3/analyze` + 5 同步(+ `/health`);Agent 的 v1/v2 整删,无兼容层。Web 端 `/api/v2/*` 与 v1 生成链路(`/v1/layout` 等)已删,**`/api/v1/*` 基建端点保留**(相册 CRUD、pages、PDF presigned、字体 subset、积分/Creem webhook、auth、admin、job 轮询)。
2. **两类模型 + 识图模型当主控**:识图模型(ark/openai 双槽 failover)既分析又主控版面;文案模型(deepseek 槽)只管文案;详见 §1.1。
3. **隐私:Stage 0 只读 `takenAt`,不抽 GPS、无地点字段**;分章只用时间 + `clusterId` + 画面整体性;redact 保留坐标键作防御红线。
4. **`albums.stage`(五环节状态主控)**:`album_stage` pgEnum = `('analysing','story','theme','cover','ready')`,Web 唯一真相源,与 `albums.status`(init 生命周期 + 积分)**正交并存、互不派生**。导出闸门 = 章节故事全章完成即解锁,主题/封面不卡导出。
5. **契约单一真相源:TS 先行,Python 镜像**:`packages/contracts`(zod)是真相源,Agent `schemas.py` 逐字段镜像(`.strict()` / `extra='forbid'`)。
6. **模板契约标准化**:模板 JSON = `category | pairing | images | svgs | texts | items | variableDecor`;旧 `slot+scene` / `quality`/`orientation` 硬约束已废,排图由 `template_select` 出意图 + 引擎在合法候选兜底(横竖比错配交 center-cover 渲染)。
7. **校验单一真相源**:finalize 单一 `validate_v3`(认 svgs/items/variableDecor/章节色/字体);无 page0-必须-cover 规则(封面可选可跳)。
8. **Agent 三真层重构(2026-06,PR #240)**:扁平 `services/` → `flows / agents / engine` + 平铺边 + `prompts`(common/rules 分层);删历史孤儿(tools.py / layout_rules 等)+ 消状态泄漏;行为零变更(契约/不变式不动)。详见 [`design.md`](./agent/design.md)。
9. **planner(未来 · 第二期)**:自然语言指令 → 自主规划调用 agents/engine 工具面;坐在现在这套无状态分层之上(stateful 仅一条指令内)。当前是 planner-ready 地基,尚未实现。
10. **中途加图**:main 上**尚未实现**;目标设计 = Web 侧可重入派生闸(分析新批次 + 合并不覆盖 + 按章补完,新章未完成则导出闸自动重关)。

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
