# Agent 重写 · 架构文档 (v2)

> 遇己(Yujee)AI 人生纪念册 · Agent 模块整本重写的**架构基线**。
> 作者:架构师。日期:2026-06-08。
>
> **前置**:`docs/agent/rebuild-requirements.md`(需求基线,已锁)→ `CLAUDE.md` → `docs/architecture.md`(十条不变式)→ `docs/agent/contract.md`(现有对外契约)。
>
> 本文**正式拍板**需求文档顶部的 3 个闸门项,定义 6 阶段数据流、v2 端点职责、状态模型、存储与契约边界,并增补隐私不变式。
> 施工细节(端点 schema、partition / pickTemplate 伪代码、Stage 1 算法、测试验收)见 [`docs/agent/rebuild-tech-plan.md`](./rebuild-tech-plan.md)。
>
> 关系:本文**不取代** `architecture.md` / `contract.md` / `design.md`,而是为"新建作品的 v2 流程"增设一层(并复用 contract/design 的 `AlbumLayoutPlan`、业务规则、错误码、日志红线)。旧 `/v1` 流程(单次扁平生成 + chat-edit)在 v2 cutover **同 PR 直接删除,无并行期**(决策 D-V1Kill,§0/§7/§8.1);删除发生在 v2 能跑之后。

---

## 0. 闸门裁定(正式拍板)

需求文档顶部 3 项需架构师闸门。逐项裁定如下,**批准,可施工**。

### 闸门 1 · 新增 `/v2/album/*` 交互端点 + 内部树形 authoring 结构 — ✅ 批准

- 新增 5 个端点:`/v2/album/{init, theme, chapter-chat, finalize, edit}`(职责见 §2)。
- 新增内部 **authoring 树**(`Album` 树,见 §4.1),**只活在交互期**,存于 `albums.draft_json`,finalize 时拍平,**永不出现在对外契约 / 渲染器 / PDF**。
- **旧端点直接删除(决策 D-V1Kill,修订需求 §7)**:`/v1/layout` 是本次要重写的**不完整 demo**,不是可回滚的兜底,留它做"并行验证"是假安全 → 在 v2 cutover 的同一 PR 里**直接删除**(`/v1/layout` + `/v1/chat-edit` + `/api/v1/internal/job-progress`)。**无并行期**。唯一前提:删除发生在 v2 能跑之后(任何时刻都得有一条生成路径在线)。旧作品兼容是**数据**层面的(见 §7),与端点存废无关。
- **对外渲染契约不变**:finalize 产物仍是现有扁平 `AlbumLayoutPlan`(`packages/contracts/src/layout.ts`),PDF 渲染器**零改动**。故底层契约本身无需闸门,只有"新增交互端点"这一项过闸门。

### 闸门 2 · `albums.draft_json` 新列 + `album_messages.chapter_id` 新列 — ✅ 批准

- `albums.draft_json jsonb`(nullable):整棵 authoring 树。仅 v2 新建作品在 `AGENT_RUNNING`/草稿/逐章期写;finalize 后可保留作审计(渲染不依赖它)。
- `album_messages.chapter_id text`(nullable)+ 复合索引:逐章对话按章归集;v1 chat-edit 消息 `chapter_id=null`。
- **只加列,不重构**(需求 §9,简单优先)。`album_pages` / `albums.layout_json` / `credit_*` 等**一律不动**。
- 迁移见 tech-plan §8。

### 闸门 3 · 积分改为 init hold / finalize settle — ✅ 批准

- **hold 时点 = `/v2/album/init`**:VLM 识图(Stage 1)是主成本,在接单建库时 `creditService.hold`。
- **settle 时点 = `/v2/album/finalize` 成功**:拍平写 `album_pages` 的同一事务里 settle。
- **release 时点(按 `agent_jobs.kind` 分流,勿写成"finalize 失败也 release")**:**`kind=init` 失败/超时 → release**;**`kind=finalize` 失败/超时 → 保留 hold**(回 EDITING 可重试,见 §5);**草稿 24h 未完成 → release**(draft-expiry sweep,tech-plan §12)。
- **逐章对话(chapter-chat / theme / edit)不单独计费**,计入同一 hold。
- **零 schema 变更**:复用现有 `credit_holds` 表 + `creditService.hold/settle/release` + `credit_ledger`。架构 §6.5 决策 1 已确认 hold/settle/release/zombie 现已接通——本闸门只是把**触发点从 `/v1/layout` 完成回调迁到 `/v2` 的 init / finalize 两端**,不新增积分逻辑。详见 §5。

> **裁定要点**:三项都不触碰对外渲染契约、不重构表、不新增积分原语。改动面 = 新增 5 端点 + **3 列**(`albums.draft_json`、`album_messages.chapter_id`、`agent_jobs.kind`)+ **1 个 active-job partial unique index** + hold/settle 触发点迁移 + 隐私不变式增补。符合需求"改动局部化 / 简单优先"。

---

## 1. 六阶段数据流

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Stage 0 · 浏览器准备                          (Browser,唯一持原图处)        │
│   ├─ Canvas 压到 800px → base64                                              │
│   └─ 压缩前抽 EXIF:takenAt   ← now-or-never(压缩丢 EXIF)                  │
│       ★ v1 不抽取 GPS(决策 D-GPS,见 §8.1):不做地点分组,无坐标进入系统   │
└──────────────────────────────┬─────────────────────────────────────────────┘
        photos[{photoId, base64, w, h, exif{takenAt?}}]                          
                               │  (经 Web 转发,Web 不落盘/不日志 base64)
                               ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ POST /v2/album/init   (异步 202 + callback;唯一带 base64 的端点)            │
│                                                                              │
│ Stage 1 · 识图 + 分组 + 去重   (火山 vision · 按 EXIF 时间分批并行 · 纯文本) │
│   每张 → analysis{desc,tags,quality,orientation,mood,scene,peopleCount,...}  │
│   分组 → 全局 EXIF 时间切章(v1 无地点维度)+ VLM groupHint 段内细分        │
│   去重 → 批内 VLM duplicateOf + 跨批确定性二次扫描                           │
│   ★ base64 当场丢弃 → 全程纯文本(v1 无 GPS/坐标进入任何阶段)              │
│                                                                              │
│ Stage 3 · 骨架排版   (确定性 · 零 LLM · 零 token)                           │
│   for each Chapter: partition(分页) → pickTemplate(选模板,seed) → 填图     │
│   + basePages{cover, toc?, ending}                                          │
│                                                                              │
│   → callback(event=completed, draftTree)  Web 写 albums.draft_json          │
│      album.status = EDITING(产品文案「草稿就绪」)                          │
└──────────────────────────────┬─────────────────────────────────────────────┘
                               │  draft_json 已就绪,图片骨架可见,主动权在用户
            ┌──────────────────┼───────────────────────────────┐
            ▼                  ▼                               ▼
┌────────────────────┐ ┌────────────────────┐ ┌──────────────────────────────┐
│ POST /v2/album/     │ │ POST /v2/album/     │ │ (用户「直接完成」或聊完)     │
│      theme  (同步)  │ │   chapter-chat(同步)│ │                              │
│                     │ │                     │ │                              │
│ Stage 2 · 主题确定  │ │ Stage 4 · 逐章对话  │ │                              │
│ 提议/问一句 →theme  │ │ +文案(按组 scoped) │ │                              │
│ 可立即出封面        │ │ 状态机 empty→…→     │ │                              │
│ (与 Stage3 独立)   │ │  generated          │ │                              │
└─────────┬───────────┘ └─────────┬───────────┘ └──────────────┬───────────────┘
          │  每轮回写 draft_json   │  每轮回写 draft_json+        │
          │                       │  album_messages(chapter_id) │
          └───────────────────────┴─────────────────────────────┘
                                                               │
                                                               ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ POST /v2/album/finalize   (异步 202 + callback)                             │
│                                                                              │
│ Stage 5 · 整体收尾 pass   (全局)                                            │
│   补全未聊章(氛围文案,不胡编)→ 开篇/结尾页 → 基调一致 → 模板节奏         │
│   → 拍平:tree → 扁平 pages[] (cover→toc→ch₁.pages→…→ending,pageIndex 重排)│
│                                                                              │
│   → callback(jobKind=finalize, event=completed, layout: AlbumLayoutPlan)    │
│      同一事务:zod 校验 → 写 album_pages + albums.layout_json                │
│                          + status=EDITING(已 finalized,可编辑/导出)        │
│                          + creditService.settle                             │
│      ★ COMPLETED 仍由 PDF 上传确认负责,finalize 不置 COMPLETED(见 §5)     │
└──────────────────────────────┬─────────────────────────────────────────────┘
                               ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ POST /v2/album/edit   (同步)        Stage 6 · 编辑                          │
│   作用于 finalized 扁平 AlbumLayoutPlan;chat-edit + pickTemplate Tool       │
│   随时换版/换图/改文案 → layoutPatch                                        │
└────────────────────────────────────────────────────────────────────────────┘
                               ▼
            浏览器本地 @react-pdf 渲染 → 直传 R2(原图始终在本地)
                       → PDF 确认成功 → album.status = COMPLETED
```

**阶段↔端点映射**

| Stage | 阶段名 | 引擎 | 所在端点 | 计费 |
|---|---|---|---|---|
| 0 | 浏览器准备 | Browser/Canvas | — | — |
| 1 | 识图+分组+去重 | 火山 vision(LLM) | `init` | **hold** |
| 2 | 主题确定 | 轻 LLM(DeepSeek) | `theme` | 计入 hold |
| 3 | 骨架排版 | 确定性引擎(0 token) | `init`(随 Stage 1 后) | — |
| 4 | 逐章对话+文案 | LLM(DeepSeek,scoped) | `chapter-chat` | 计入 hold |
| 5 | 整体收尾+拍平 | LLM + 确定性拍平 | `finalize` | **settle** |
| 6 | 编辑 | LLM + pickTemplate Tool | `edit` | finalize 后编辑**不计费**(hold 已 settle) |

> **关键边界**:Stage 1 是唯一吃 base64 的阶段;Stage 3 是确定性的(零 LLM,可即时排),与 Stage 2 主题**相互独立、不互相阻塞**(需求 §2)。故 init 在跑完 Stage 1 后立刻跑 Stage 3 出骨架,**不等主题**——主题只影响封面与渲染 style token,不影响图片骨架。

---

## 2. v2 端点与职责

Agent 仍是**单一无状态 FastAPI 服务**(架构 §1.1)。v2 在现有 `apps/agent/src/routes/` 下新增端点,**不新增顶层目录**。

| 端点 | 传输 | Stage | 带 base64 | 计费动作 | 职责一句话 |
|---|---|---|---|---|---|
| `POST /v2/album/init` | 异步 202+callback | 1 + 3 | ✅ 唯一 | hold | 识图分组去重 + 排骨架,回 draftTree |
| `POST /v2/album/theme` | 同步(≤30s) | 2 | ❌ | — | 定主题 / 出封面 |
| `POST /v2/album/chapter-chat` | 同步(≤30s) | 4 | ❌ | — | 单章对话 + 灌本章文案 |
| `POST /v2/album/finalize` | 异步 202+callback | 5 | ❌ | settle | 补全未聊章 + 收尾 + 拍平成扁平 layout |
| `POST /v2/album/edit` | 同步(≤60s) | 6 | ❌ | — | finalized layout 上的 chat-edit + 换版 |

**传输模式裁定理由**

- `init` / `finalize` **异步**:都含多次 LLM 调用(分批识图 / 多章补文),耗时秒级以上,且对应产品「处理中」「完成中」态(需求 §10.1)。复用 `agent_jobs`(新增 `kind` 列区分两类 job,见 §4.3)+ **专用 v2 callback envelope**(带 `jobKind` 判别符)+ zombie sweeper 基建(`design.md §7`)。
  - **不复用 v1 的 `completed` variant**:v1 的 discriminated union 里 `completed` 必带 `layout` 且 `extra='forbid'`(`design.md §8`)。v2 的 init `completed` 载荷是 `draftTree`,与之**形状互斥**,塞进同一 variant 会破坏严格 union。故 v2 走**独立 callback schema**(`V2Callback`,`jobKind ∈ {init, finalize}` 作判别符)+ 独立路由 `POST /api/v2/internal/job-progress`。`jobKind=init` 的 completed 带 `draftTree`;`jobKind=finalize` 的 completed 带扁平 `layout`。两者字段集各自 `extra='forbid'`,不互通。详见 tech-plan §1.1 / §1.4。
- `theme` / `chapter-chat` / `edit` **同步**:用户在等单轮回复,单次 DeepSeek 调用,无需轮询。语义同现有 `/v1/chat-edit`(`contract.md §2.2`)。

**为什么 Agent 仍无状态**:见 §3。

> **职责红线**:Agent 不读写数据库、不持树。每个 v2 端点的全部上下文都由 Web 在请求体里传入(init 传 base64+exif,其余传所需的树切片)。Agent 算完即返回,不留任何数据(不变式 3)。

---

## 3. 状态模型:Agent 无状态 + Web 持树

需求 §7:**agent 仍无状态;base64 只用一次、之后全文本,Web 持有树并每轮回传。**

```
            ┌─────────────────────────────────────────────┐
            │ Web (Next.js + Postgres)  ── 状态唯一持有者  │
            │                                             │
            │  albums.draft_json  =  authoring 树(权威)  │
            │  album_messages     =  逐章对话历史          │
            │  album_pages        =  finalize 后的扁平页   │
            └───────────────┬─────────────────────────────┘
                            │  每轮:取树切片 → 请求
                            ▼                ▲  返回:更新后的树切片 / patch
            ┌─────────────────────────────────────────────┐
            │ Agent (FastAPI)  ── 纯函数,无状态           │
            │  入参自带全部上下文,算完即弃                 │
            └─────────────────────────────────────────────┘
```

**Web 持树的回传粒度(裁定)**——需求同时要求"上下文只含本组,永不喂整本"(§1.1)与"Web 每轮回传"(§7)。两者通过**作用域裁剪**调和:

| 端点 | Web → Agent 传入 | Agent → Web 返回 | Web 持久化 |
|---|---|---|---|
| `init` | base64+exif 全量 + meta | 整棵 draftTree(callback) | 写 `draft_json` 全树 |
| `theme` | clusters 概览(各章 label/photo desc 摘要,**不含 base64**)+ 用户消息 | `theme{...}` + 可选 cover 草案 | merge 进 `draft_json.meta` + `basePages.cover` |
| `chapter-chat` | **仅当前章** {chapterId, cluster, photoIds 的 analysis, brief?, history[], userMessage} | {assistantReply, chapterBrief?, pages.texts, state} | merge 进该 `chapter`,写 `album_messages(chapter_id)` |
| `finalize` | 整棵 draftTree(无 base64) | 扁平 `layout`(callback) | 拍平写 `album_pages` |
| `edit` | 扁平 `currentLayout` + history + userMessage | `layoutPatch` | 更新 `album_pages` + `album_messages(chapter_id=null)` |

> chapter-chat **只送本章**:本章照片的结构化 `analysis`(纯文本)+ 本章对话历史,绝不喂整本树或其它章。这同时满足"上下文只含本组"与"payload 有界"(单章上限 ≈ 几页 × 4 张 analysis,几 KB)。

**payload 有界性**:全树(init/finalize 回传)= 30 张 analysis + ≤16 页骨架的纯文本,量级 ~tens of KB,远低于请求体上限;chapter-chat 单章更小。无 base64 后不存在大载荷。

---

## 4. 存储与契约边界

### 4.1 authoring 树(`albums.draft_json`)——只活在交互期

```ts
// 形态总览;完整 zod 见 tech-plan §2(packages/contracts/src/v2.ts)
Album {
  meta: { theme?: {subject, occasion?, timeframe?, tone}, style, language }
  photoPool: Photo[]      // Photo{ photoId, analysis{...}, exif{takenAt?, place?}, duplicateOf?, used }
  basePages: { cover, toc?, ending }
  chapters: Chapter[]     // Chapter{ chapterId, state, cluster, photoIds[], brief?, pages[] }
}
// Page{ pageIndex, templateId, images:{slot→photoId}, texts:{slot→str} }
```

- 树**整棵**塞 `albums.draft_json`(jsonb)。Web 是唯一持有者;Agent 每轮收切片、回切片。
- `exif.place` 只存**粗地名**(城市/地标级);**原始经纬度永不入树**(不变式增补,§6)。
- `Photo.duplicateOf` 折叠重复,`used=false` 保留不删(需求 §6)。

### 4.2 拍平边界(finalize)

```
draftTree ──finalize──► pages[] = cover → toc? → ch₁.pages → ch₂.pages → … → ending
                        (pageIndex 重排 0..N-1)
                        → AlbumLayoutPlan { magazine, photos, pages }   ← 对外契约,零改动
```

- **树永不进渲染器 / PDF / 对外契约**(不变式增补 §6)。渲染器只认扁平 `AlbumLayoutPlan`。
- `magazine` 由 `meta.theme + style + language` 拍平得出;`photos` = `photoPool` 里 `used=true` 的 `analysis` 映射成现有 `PhotoAnalysis`;`pages` = 各章 pages 顺序拼接 + basePages。

### 4.3 表与列(闸门 2 已批)

| 表 | 改动 | 说明 |
|---|---|---|
| `albums` | **+ `draft_json jsonb` (null)** | authoring 树;v1 作品恒为 null |
| `album_messages` | **+ `chapter_id text` (null)** + index `(album_id, chapter_id, created_at)` | 逐章对话归集;v1 chat 消息 null |
| `album_pages` | **不动** | finalize 拍平后写入,渲染唯一来源 |
| `albums.layout_json` | **不动** | finalize 同时写,兼容现有读路径 |
| `credit_holds` / `credit_ledger` | **不动** | 复用 hold/settle/release |
| `agent_jobs` | **+ `kind agent_job_kind` enum(`init`\|`finalize`),NOT NULL default `init`** | init/finalize 复用同一表但**失败/收尸转换不同**(见 §5),sweeper/callback 按 `kind` 分流;存量行默认 `init` 不受影响 |

> **闸门 2 范围微调(已并入裁定)**:除 `draft_json` / `chapter_id` 两列外,新增 `agent_jobs.kind` 列。理由:finalize 失败必须回 `EDITING` 且保留 hold,init 失败必须 `FAILED` 且 release(§5)——两类 job 的失败语义相反,sweeper 直接扫 `agent_jobs` 时需自包含判别,不应隐式耦合到 `draft_json` 是否存在。该列同为 nullable-safe(default `init`),符合"只加列不重构"。

### 4.4 模板单一真相源(不变)

`packages/contracts/templates/*.json` 仍是唯一真相源(21 个:mag-01~20 + p01)。TS / Python loader 单向派生。Stage 3 的 pickTemplate、Stage 6 edit 的换版均只从此集合取 templateId。**Agent 不得自由生成 templateId**(`design.md §5`)。

---

## 5. 积分:init hold / finalize settle(闸门 3)

**积分时点全景(状态转换均按 `agent_jobs.kind` 分流)**

```
/v2/album/init (kind=init) 接单
   └─ 事务:建 album(status=AGENT_RUNNING) + creditService.hold(N)  ──► HOLDING
        │                                                              ledger: GENERATION_HOLD
        ├─ Stage1+3 成功 → callback completed → album.status=EDITING(「草稿就绪」)  hold 仍 HOLDING
        │                  (写 draft_json;layout_json 仍为 null)
        └─ Stage1 失败 / 超时(kind=init)→ album FAILED + creditService.release ──► RELEASED
                                                                       ledger: GENERATION_RELEASE
草稿期(theme / chapter-chat / edit-before-finalize)
   └─ 不动 hold(不单独计费);每轮 touch albums.updatedAt(供 24h 过期判定)

/v2/album/finalize (kind=finalize) 接单 → album.status=AGENT_RUNNING(「完成中」)
   ├─ callback completed → 事务:zod 校验 layout → 写 album_pages + albums.layout_json
   │       + album.status = EDITING(已 finalized,可编辑/导出)
   │       + creditService.settle(hold)  ──► SETTLED      ledger: GENERATION_SETTLE
   │       ★ 不置 COMPLETED——COMPLETED 仍由 PDF 上传确认负责(docs/web/api.md §3.6/§3.7)
   └─ 失败 / 超时(kind=finalize)→ album 回 EDITING(草稿仍在)+ hold 维持 HOLDING(可重试 finalize)
                                                            ★ 与 kind=init 相反:不 release、不 FAILED

PDF 上传确认成功 → album.status = COMPLETED(终态,不动 hold)

草稿 24h 未 finalize(EDITING + layout_json=null + hold HOLDING + updatedAt 超 24h)
   └─ draft-expiry sweep(tech-plan §12)→ creditService.release(产品文案「已释放预留积分」)
重新进入草稿(24h 内,hold 仍 HOLDING)→ 沿用原 hold,不二次扣(需求 §10.5)
重新进入草稿(已 release 后)→ finalize 时重新 precheck + hold
```

- **`kind` 驱动失败语义(关键)**:`agent_jobs.kind` 决定 callback-failed 处理器与 zombie sweeper 走哪条转换——`kind=init` → `FAILED + release`;`kind=finalize` → `EDITING + 保留 hold`。读时收尸与每日 cron 两条收尸路径**都必须按 `kind` 分流**(tech-plan §6 / §12),不能沿用旧"一律 FAILED+release"。
- **状态机区分草稿 vs finalized**:二者都是 `EDITING`(不新增 album 状态)。判别符 = `layout_json IS NULL`(草稿就绪,可逐章聊/finalize)vs `layout_json` 非空(已 finalized,可编辑/导出)。「完成中」= finalize job RUNNING 期间的 `AGENT_RUNNING`,UI 文案由该 job 的 `kind=finalize` 驱动。
- **hold 金额 N**:复用现有按生成计费的金额(现 `/v1/layout` 的 hold 金额逻辑),**不新增定价**。VLM 识图是主成本,故在 init hold 合理。
- **settle 只在 finalize 成功**,对齐架构 §6.5 决策 1「失败不扣、成功扣一次、重试不重复」。
- 全部积分变更在 **DB 事务**里,与 album / job 状态变更原子(不变式 8)。

> **与现状的差异**:现状 settle 发生在 `/v1/layout` 的 completed 回调且置 COMPLETED(`contract.md §9.2`)。v2 把 **settle 后移到 finalize 成功**,且 finalize 成功只置 **EDITING**(成品可编辑),COMPLETED 留给 PDF 确认。hold 触发点不变(生成起点,现叫 `/v2/album/init`)。

---

## 6. 不变式增补(EXIF / GPS 隐私 + 树边界)

`architecture.md §3` 十条不变式**继续全部有效**。本次重写**增补**两条,并扩充日志红线。增补条同步登记到 `architecture.md §3`(落地清单见 tech-plan §7 末行)。

**不变式 11(隐私 · GPS/EXIF)**
> **v1 决策(D-GPS,§8.1):完全不抽取 GPS** —— 浏览器 Stage 0 只读 `takenAt`,坐标根本不进入系统,故无地点分组、`place` 恒为 null、无创建页"包含地点信息"开关。`takenAt`(时间)低敏,可入 `draft_json`(排序/分组需要)。
> **未来若启用 GPS**(v2 backlog),则原始经纬度 = base64 同级机密:只用于反查一次粗地名当场丢弃,绝不入库/日志/draft_json,入库的只有城市/地标级 `place`。本不变式作为该约束的**预置红线**保留。

**不变式 12(authoring 树边界)**
> authoring 树只存在于 `albums.draft_json` 与交互期请求体中。finalize 时拍平成扁平 `AlbumLayoutPlan` 写 `album_pages`。**树永不进渲染器 / PDF / 对外契约 / callback 的 `layout` 字段。** 对外契约恒为扁平 `magazine + photos + pages[]`。

**日志红线增补**(`design.md §9` 禁打字段表新增,**防御性保留 —— 即便 v1 不抽 GPS,redact 列表仍含坐标键,防未来回归/误传**):
- `lat` / `lng` / `latitude` / `longitude` / `gps` / `coordinates` / `place` / EXIF 原始块 → 一律 `<redacted>`。
- Agent structlog redact processor 的 key 列表追加上述项;测试断言不出现在日志(对齐 `design.md §9` 实施约束)。

**隐私自查(对齐需求 §11 验收)**:原图 base64——不落库、不进日志。**v1 不抽 GPS**,坐标不存在(比"只存粗地名"更强地满足 §11 隐私验收)。init 端点是唯一接触 base64 之处,识图后立即丢弃。

---

## 7. 旧 album 数据兼容(与端点存废无关)

旧作品的兼容是**纯数据**层面的,**不需要**保留任何 `/v1` 端点:

- **旧作品**(老 pipeline 生成):已是扁平 `layout_json` + `album_pages` 的 finalized 态,`draft_json=null`。**照旧渲染,零数据迁移**(需求 §9)——渲染只读 `album_pages`,与端点无关。
- **新作品**:走 v2 全流程;`draft_json` 非空直至(可选)finalize 后清理。
- **旧作品编辑统一走 `/v2/album/edit`**:旧作品本就是扁平 `AlbumLayoutPlan`(`layout_json`),而 `/v2/album/edit` 的入参正是扁平 layout → **新旧作品共用同一条编辑路径**。`/v1/chat-edit` 因此无独立价值,随 cutover 删除(`/v2/album/edit` = chat-edit + pickTemplate Tool 超集)。
- **判别**:Web 按 `albums.draft_json IS NULL` 区分新旧;编辑器对二者都读 `album_pages` 渲染(统一),"是否还能逐章聊 / 是否已 finalize"看 `draft_json` 与 `layout_json`。
- **结论**:删 `/v1` 端点 = 删代码,**不触碰任何旧作品数据**;旧作品渲染/编辑全部由 `album_pages` + `/v2/album/edit` 承接。

---

## 8. 默认裁定(可否决)

以下是**锁定需求之间的工程空隙**,我按需求精神裁定,**未扩张需求**。标注 ✅ 的已经过首轮架构评审并据此收敛;若产品/你有异议可否决:

1. ✅ **finalize 异步(202+callback)**,但用**独立 v2 callback envelope + `jobKind` 判别符**(不复用 v1 严格 union),失败/收尸按 `agent_jobs.kind` 分流(§2/§5)。
2. ✅ **chapter-chat / theme / edit 同步**:用户在等单轮。
3. ✅ **init 内 Stage 3 不等 Stage 2**:骨架先于主题出(需求 §2)。**但 finalize 若检测到 theme 缺失,必须先确定性/轻 LLM 生成默认 theme**,再写 cover/ending——保证"全程不聊天也能直接完成"(需求 §11 第 2 条,见 tech-plan §5.2)。
4. ✅ **chapter-chat 只送本章切片**,不回传整树(调和 §1.1 vs §7)。
5. ✅ **hold 金额复用现有生成定价**,不新增定价模型(D-Hold,§8.1 已拍板)。
6. ✅ **finalize 失败/超时 → 回 EDITING + 保留 hold(可重试)**;**init 失败 → FAILED + release**;**草稿 24h 过期 → release**。三条转换由 `agent_jobs.kind` 区分(§5),sweeper/callback 两端同步分流。
7. ✅ **init 与 finalize 复用同一 `agent_jobs` 表 + 新增 `kind` 列**判别(不靠隐式推断),各自独立 `requestId`,同 album 同 kind 互斥(tech-plan §11)。
8. ✅ **`/v2/album/edit` 是 `/v1/chat-edit` 的超集**(+ pickTemplate Tool),是新旧作品**唯一**编辑路径;**`/v1` 全部端点在 v2 cutover 同 PR 直接删除,无并行期**(D-V1Kill,§0/§7)。
9. ✅ **finalize 成功置 EDITING(成品可编辑/导出),不置 COMPLETED**;COMPLETED 仍由 PDF 确认负责。

### 8.1 已确认决策(2026-06-09 · 产品/架构拍板)

原开放项已全部拍板,以下为定稿,施工以此为准:

| 项 | 决策 | 影响 |
|---|---|---|
| **D-GPS · 地点分组** | **v1 完全不抽取 GPS、不做地点分组**(后置到 v2 backlog) | 收窄需求 §6/§8/§10.4:分组主键退化为**纯 EXIF 时间**;`place` 恒 null;无创建页"包含地点信息"开关;无反查/geocode 服务。隐私上更强(坐标根本不入系统)。不变式 11 作为未来启用 GPS 的预置红线保留。详见 tech-plan §3.1/§3.3 |
| **D-Kind · agent_jobs.kind** | **接受新增第三列** `agent_jobs.kind enum('init','finalize')` | 闸门 2 由 2 列扩为 3 列;sweeper/callback 按 kind 自包含分流(§4.3/§5)|
| **D-Hold · 金额 N** | **复用现有 `/v1` 生成定价**,不新增定价模型 | init hold / finalize settle 沿用既有金额逻辑(§5)|
| **D-Expiry · 草稿过期** | **24h 释放 hold,album 留 EDITING-草稿可重来**;再 finalize 时重新 precheck+hold | draft-expiry sweep(tech-plan §12);不新增 album 状态、不清空草稿 |
| **D-V1Kill · 旧流程** | **直接删除 `/v1` 全部端点,无并行验证期** | 修订需求 §7"保留至验证通过再废":旧流程是不完整 demo,非可回滚兜底,留着是假安全。cutover 同 PR 删 `/v1/layout`+`/v1/chat-edit`+`/api/v1/*`;旧作品数据零迁移、编辑统一走 `/v2/album/edit`(§7)|

> **D-GPS 是对锁定需求的显式收窄**(非扩张):需求 §8 原写"GPS 默认抽取 + 反查粗地名",本决策 v1 整体不做。已据此同步两份文档全部 GPS 相关条目;若后续要恢复,按不变式 11 预置红线施工。

---

## 9. 架构师自查

- [x] 对外渲染契约(扁平 `AlbumLayoutPlan`)未变,PDF 渲染器零改动。
- [x] 树只活在 authoring 期 + draft_json,finalize 拍平,永不进渲染器(不变式 12)。
- [x] base64 只在 init 用一次即弃,不入库/日志(不变式 11);**v1 不抽 GPS,坐标不入系统**(D-GPS)。
- [x] 模板单一真相源 `packages/contracts/templates/` 未动。
- [x] Agent 仍无状态;Web 持树每轮回传,作用域裁剪保证有界。
- [x] 只加列不重构表(`albums.draft_json` + `album_messages.chapter_id` + `agent_jobs.kind` 三列 + 一个 partial unique index);积分复用现有原语,只迁触发点。
- [x] 3 个闸门项全部正式拍板(§0)。
- [x] 未自行扩张需求;空隙裁定显式列出可否决(§8)。
