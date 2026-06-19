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
| 用户路径(V3 五环节)| 选照片 → 秒级进编辑器 → ① 分析(后台)→ ② 章节故事 → ③ 确定主题与章节色 → ④ 书籍设计 → ⑤ 待导出(浏览器出 PDF)|
| 初期容量目标 | 1000 用户(简单优先)|
| 长期容量目标 | 10 万用户(预留扩展,但**第一版不实施**)|

---

## 1. 系统切分:三个组件

> 下图为 **V3** 三端边界(五环节状态机)。CJK 宽字在等宽终端里框线会略错位,以内容为准。

```
┌──────────────────────────┐      ┌──────────────────────────┐      ┌──────────────────────────┐
│         Browser          │      │     Web (Next.js 15)     │      │     Agent (FastAPI)      │
├──────────────────────────┤      ├──────────────────────────┤      ├──────────────────────────┤
│ 选照片 / 端内压缩 800px   │      │ 建相册 + ≤0.5s 跳编辑器   │      │ 无状态,不存任何数据       │
│ Stage0 读 EXIF 取 takenAt │      │ (分析任务后台异步跑)      │      │                          │
│ 不抽 GPS · 无地点维度     │ ───► │ 转发 base64,不落盘        │ ───► │ 识图模型(GPT-5.5 Mini /  │
│ 五环节 UI/面包屑/加载动画 │      │ 持 layout 树 + stage      │      │ 火山 failover):分析+版面 │
│ 章节故事交互组件          │ ◄─── │ (五环节状态唯一真相源)    │ ◄─── │ 主控                     │
│ 封面/封尾单独成页(画板)   │      │ 调度各环节对 Agent 调用   │      │ DeepSeek:章节文案        │
│ 本地渲染 PDF → 直传 R2    │      │ 积分:init 成功即按张扣    │      │ 确定性引擎:分组/套模板/  │
│                          │      │ 导出失败日志(飞书后置)    │      │ flatten/校验             │
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
- Canvas 压缩到 800px、quality 0.6 → base64 data URL 作为"特征载体"。
- **Stage 0 读 EXIF**:只取 `takenAt`(排序/分章用)随 base64 发出;**不抽取 GPS、不做地点反查**(§3 隐私 / §6.8 第 3 条:排版不需要地址,反查成本与体验提升不成正比)。
- 用 React 模板渲染**五环节 UI**:顶栏常驻面包屑(分析 > 章节故事 > 确定主题 > 书籍设计 > 待导出,当前环节高亮)、分析期加载动画(「正在分析照片」)、章节故事交互组件(对话 + 缩略图条)。
- **画板把封面/封尾单独成页**展示,不混进明细跨页。
- 章节故事/编辑时,把当前 layout 切片 + 用户消息发给 Web(非全树)。
- 用户点导出 → 浏览器本地用 `@react-pdf/renderer` 生成 PDF → 直传 R2(失败自动重试 ≤3 次,连续 3 次失败弹安抚框)。

**Web (Next.js)**
- 唯一与用户、数据库、支付打交道的组件。
- **建相册 + 秒级跳转编辑器**:点「下一个」≤0.5s 进编辑器,`/v3/analyze` 后台异步跑,不阻塞进入。
- 收到 base64 后**不落盘、不存 R2、不写日志**,直接转发给 Agent。
- **持有 layout 树(`draft_json`)+ `stage`**:`stage` 是整本相册五环节状态的**唯一真相源**(Agent 不持 stage);保存 layout 树 + 对话历史(`album_messages`),不是图片。
- **调度各环节对 Agent 的调用**:转发切片、合并补丁/子树写回 DB、推进 `stage`、控导出闸门(章节故事全完成才解锁)。
- **积分扣费**:init 成功即按张实扣(`⌈张数/10⌉`),失败 `release`(§6.7 / §6.8);其余环节免费。
- PDF 上传走 R2 presigned PUT,Web 不过 PDF 流量;导出连续失败记错误日志(飞书推送后置)。

**Agent (FastAPI)**
- 无状态服务。无数据库连接。无文件系统持久化。
- 承载**两类模型 + 确定性引擎**(V3):
  - **识图模型**(GPT-5.5 Mini 主 / 火山 doubao-vision failover):图片分析 + 当「主控」做一切改变版面观感的判断(套模板/主题/章节色/布局变动)。
  - **DeepSeek**:章节文案,不碰布局。
  - **确定性引擎**:分组 / 套模板 / flatten / 校验,无 LLM。
- 端点集 = 1 异步(`/v3/analyze`)+ 5 同步(§2);旧 `/v1`、`/v2` 在 V3 调通后整删。
- 每次调用收完整上下文、回补丁/子树,Web 合并入库;不直接被浏览器调用,只被 Web 调用。

### 1.2 为什么这样切

1. **图片不落盘** —— 用户隐私是核心承诺。Web 和 Agent 都不存原图。
2. **Web 不做 AI** —— Next.js serverless 不适合长任务和大依赖。
3. **Agent 不碰用户数据** —— Agent 只看到 base64 和文本,挂掉只影响生成,不影响登录/支付/已有作品。
4. **PDF 在浏览器生成** —— 原图始终在本地。Web 只签 URL,不接 PDF 流量。

---

## 2. Web ↔ Agent 协议(骨架)

> **【V3 · 2026-06-18 架构拍板】** 协议整切到全新 `/v3/*` 端点集,对应五环节状态机(`v3-requirements.md §2`);`/v1`、`/v2` 在 V3 调通后**整套删除**,不留兼容层(§6.8)。本节只锁骨架——详细 req/res、错误码、状态机见 [`docs/agent/contract.md`](./agent/contract.md);Agent 内部 pipeline、failover、redact 边界见 [`docs/agent/design.md`](./agent/design.md)。

Agent 暴露**一个异步端点 + 五个同步端点**:

### 2.1 分析 — `POST /v3/analyze`(异步,唯一异步端点)

- **为什么异步**:多图识图 1–2 min;支撑「点下一个 ≤0.5s 进入编辑器 + 后台分析」硬红线——**建相册 + 跳编辑器与分析任务解耦**,分析未完不阻塞进入。
- Agent 接单即 `202`,后台跑,回推 `POST /api/v3/internal/job-progress`(`progress`/`completed`/`failed`)。
- **入参**:base64 照片 + EXIF(只有 `takenAt`,无地点;§3 隐私)。
- **出参(回调)**:套模板 + 通用文案/通用色的**预览态 layout 树**。
- **浏览器侧**:轮询相册状态,不开 SSE(理由见 2.3)。

### 2.2 其余四环节 — 同步端点(秒级,前端转圈)

| 环节 | 端点 | 模型 |
|---|---|---|
| 章节故事 | `POST /v3/chapter-chat` | DeepSeek(涉版面变动时升级识图模型)|
| 主题/章节色 · 推荐 | `POST /v3/recommend` | 识图模型 |
| 主题/章节色 · 应用 | `POST /v3/apply-theme` | 无(确定性脚本)|
| 书籍设计(封面/封尾)| `POST /v3/cover` | 无(确定性脚本)|
| 待导出 | `POST /v3/finalize` | 无(确定性 flatten)|

- 均**同步 HTTP**,不轮询、不回调;每端点是纯变换「输入切片 → 输出补丁」,可重试、可水平扩展。
- **`stage` 推进权在 Web**:Agent 不持 stage,只做无状态变换;Web 合并补丁、记 stage、控导出闸门。
- Web 允许封面环节从 `theme` 直接跳到 `ready`(跳过 cover),也允许常规 `cover -> ready`。
- layout 树**按需切片传**(②传单章;③④传相关页),全树只在 ⑤ finalize 传一次,控识图模型 token。

### 2.3 共通

- **鉴权**:Bearer Token,共享密钥 `AGENT_SHARED_SECRET`,所有端点通用。
- **超时**:接单 5s;同步端点 60s;Agent → 外部模型 30s 重试 1 次;Agent → Web callback 10s 重试 2 次。
- **模型通道**:识图模型默认走 OpenAI 兼容槽(`OPENAI_*`),不可用 / 批量过慢时 failover 火山(`ARK_*`);DeepSeek 走自有槽。
- **失败语义**:异步 `/v3/analyze` 走回调 `failed`;同步端点走 HTTP 错误码;前端可重试,不污染 `stage`。

**为什么不用 SSE**:Vercel serverless 多 lambda 实例,进程内 EventEmitter 无法跨实例,SSE 接收端和回调接收端不在同一进程,**1 个用户就不通**。轮询零依赖、零运维、Vercel 上必然工作,1000 用户阶段足够。

---

## 3. 不变式(违反 = bug)

> 施工反复对照的重点只有两类:**① Server 端数据归属**、**② 积分数据变更**。其余是边界红线,一次说清、不重复强调。

**① 数据归属(重点)**
1. **Web 是唯一真相源**:持 layout 树(`draft_json`)+ `stage`;**Agent 无持久状态**(无 DB / FS / 会话),每次收完整上下文、回补丁——同步端点纯函数可水平扩展,异步 analyze 仅进程内瞬态。
2. **分层归属**:Service 方法第一参数 `userId` / `actor`;Route ≤ 40 行只编排、不 import drizzle;Service 不跨用别的 service 的 repo。
3. **authoring 树边界**:`draft_json` + 交互期请求体**永不进渲染 / PDF / 对外契约**;finalize 拍平成扁平 `AlbumLayoutPlan`(章节色/字体烘焙进扁平页,渲染契约不加树形字段)才落 `album_pages`。

**② 积分变更(重点)**
4. 积分变更在 DB 事务里、与 album 状态变更**原子**;**init 成功即按张实扣**(`⌈张数/10⌉`)、失败 `release`、成功只扣一次、重试不重复(§6.7)。

**边界红线(知道即可,不赘述)**
5. **隐私**:原图与 base64 只在「浏览器 → Agent」内存链路过,**不入库 / R2 / 日志**;**不抽 GPS、无地点/坐标字段**(redact 仍拦坐标键作防御);PDF 浏览器生成 + presigned 上传。
6. Agent 输出 layout 写库前必 **zod 校验**;`AGENT_SHARED_SECRET` 不进任何 client bundle。

---

## 4. 项目目录(顶层)

```
memoir-agent-rebuild/
├── apps/
│   ├── web/
│   │   ├── src/              # Next.js 源码       → docs/web/*
│   │   ├── fonts/            # 全量 Noto SC TTF(server-only,非公开)— PDF subset 源,见 #31
│   │   └── design-v1/        # V1 UI 实现稿(HTML),React 化前的视觉权威源
│   └── agent/                # FastAPI 服务       → docs/agent/*
│       └── src/skills/       # V3 skill = prompt 资产(识图模型加载),集中存放、人工维护(§6.8 第 2 条)
├── packages/
│   └── contracts/            # 跨服务 zod schema + TS 类型
│       └── templates/        # 相册模板 JSON 单一真相源
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



### 6.8 V3 架构拍板(2026-06-18)

> V3 = 五环节状态机重构(分析 → 章节故事 → 确定主题与章节色 → 书籍设计 → 待导出)。需求真相源 = [`docs/agent/v3-requirements.md`](./agent/v3-requirements.md)(已评审)。本节只登记**架构层**结论(不变式 / 协议 / schema / 契约 / 施工地基排序);产品与交互细节不在此重复。

1. **端点全切 `/v3/*`,旧端点整删**(§2):新建 1 异步 `/v3/analyze` + 5 同步端点。**无真实用户**,V3 调通后 `/v1`、`/v2` 的路由 + service + 旧 schema + 旧测试**整套删除**,不留兼容层、不灰度。前端 UI 复用 V2 编辑器框架(画板/对话板/缩略图条),只按五环节状态机改交互流;Agent 内部逻辑能迁就迁、**以满足 V3 为准**(复用不便处直接重写)。
   - **整删范围 = 生成链路**:Agent `/v1/layout`·`/v1/chat-edit`·`/v2/album/*` + Web 侧对应编排路由/service/schema/测试。**基建型 v1 端点保留**——PDF presigned 上传、字体 subset、积分/Creem 支付 webhook、auth、以及 V3 仍复用的 job 轮询/相册 CRUD。删前**逐个核实引用方、定保留白名单**(防误伤导出/支付/字体链路)。

2. **两类模型 + 识图模型当主控**:① **识图模型 = GPT-5.5 Mini(主,`OPENAI_*` 槽);火山 doubao-vision failover(`ARK_*`)**——既做图片分析,又当「主控」负责一切改变版面观感的判断(套模板 / 主题 / 章节色 / 布局变动)。② DeepSeek 只管章节文案,不碰布局。failover 触发阈值(GPT 不可用 / 批量过慢)留**模块施工文档**敲定。

3. **§3 隐私红线(GPS/place)— V3 不接入**:见 §3 隐私。原 V3 草案拟「浏览器 Stage 0 读 GPS → 反查粗地名 `place` 供分章」,**产品拍板撤销**:排版不需要地址,GPS 反查(本地全球城市库几 MB / 外部地理 API 配额成本)与体验提升不成正比。**结论:Stage 0 只读 `takenAt`,不抽 GPS,不产出地点/坐标字段,分章只用时间 + 画面整体性信号。** redact 列表保留坐标键作防御红线。`v3-requirements §11` 原列的「反查放哪端」开放点随之作废。

4. **新增 `albums.stage`(五环节状态主控,需 schema 迁移)**:整本相册当前环节存 Web DB,Web 唯一真相源,Agent 不持 stage。
   - **迁移 `0007`**:新增 `album_stage` pgEnum = `('analysing','story','theme','cover','ready')` + `albums.stage` 列,`notNull default 'analysing'`;现有行回填(`status COMPLETED/EDITING → 'ready'`,`AGENT_RUNNING → 'analysing'`;无真实用户,回填量极小)。
   - **`stage` 与 `albums.status` 正交并存,互不派生**:`status`(`AGENT_RUNNING|EDITING|COMPLETED`)只管 init 任务生命周期与积分扣减(沿用 V2);`stage` 只管用户走到第几环 + 导出闸门。两列各自独立写——例:init 成功 → `status=EDITING`,而 `stage` 仍可停在 `story`。
   - **导出闸门**:`stage` 达「章节故事全部章节完成」即解锁导出;主题(theme)/ 封面(cover)**不卡导出**。

5. **契约单一真相源:TS 先行,Python 镜像**:V3 大量新增 layout 树字段(章节色 / 字体 / `variableDecor` / `items`),借 V3 把 `packages/contracts`(TS/zod)补成单一真相源,Agent `schemas.py` 重新对齐镜像。**契约重整 + 模板 loader 迁移 = 所有 `/v3/*` 端点的前置地基**(「起不来就别往上盖」),实施计划必须排在最前。

6. **模板契约标准化(承接 §6.6)**:模板 JSON 统一为 `category | pairing | images | svgs | texts | items | variableDecor`(替代旧 `slot+scene`、`repeat:true`+bracket-path)。**图片槽 `quality` / `orientation` 概念整体作废**——`can_place` / `_is_hero_slot` / hero-cap 硬约束全废;排图改由 `select-template` skill 出意图 + 确定性引擎在合法候选里兜底(横竖比错配交 center-cover 渲染)。Python `templates.py` / `skeleton.py` / `finalize.py` 必须先迁到本契约,否则 Agent 起不来——属第 5 条地基层。

7. **校验单一真相源**:删除当前分叉的双 `validate_v2`,合并成单一 validate;**删 page0-必须-cover 规则**(封面可选、可跳过),认 `svgs` / `items` / `variableDecor` / 章节色 / 字体字段。

8. **积分不变**(§6.7):init 成功即按张实扣(`⌈张数/10⌉`),失败 `release`;**不引入锁定 / R2 / 8h 三段式**。V3 只需新 `/v3/analyze` init 回调**复用同一 settle 路径**,不改 `creditService` / `handleInitCompleted`。

9. **导出失败处理**:本地出 PDF / R2 上传失败 → 自动重试 ≤3 次 → 连续 3 次失败 → 前端弹安抚框 + 错误日志;**飞书服务台推送后置**(方案已调研,上线后视失败率再加,`v3-requirements §4.5d`)。失败**不碰积分**。

10. **去重 union-find 删残留**:V3 不做单批去重(单批从不触发),清掉残留代码。

---

## 7. 怎么读这份文档系列

不要从头到尾读 `docs/`。按角色加载:

1. **任何任务开始前** → 读 `CLAUDE.md`(根目录,~150 行)
2. 在 `CLAUDE.md` 找你的**角色行**,看起手必读清单
3. 按清单**一份一份读**,读完一份再读下一份
4. 任务过程中遇到清单外的细节(如表字段、错误码、协议字段),按需查对应子文档

完整角色→文档映射表在 `CLAUDE.md` §3。
