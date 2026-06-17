# Agent 重写 · 技术方案 (v2)

> 遇己(Yujee)Agent 整本重写的**可施工技术方案**。
> 作者:架构师。日期:2026-06-08。
>
> **前置**:[`rebuild-requirements.md`](./rebuild-requirements.md)(需求,已锁)→ [`rebuild-architecture.md`](./rebuild-architecture.md)(架构,闸门已拍板)→ `contract.md` / `design.md`(现有契约与内部设计)。
>
> 本文给出:v2 各端点 req/res schema、`draft_json` JSON 形状、Stage 1 分批识图+分组+去重算法、Stage 3 partition / pickTemplate(含 seed)伪代码、旧 album 兼容与回退、测试验收(对齐需求 §11)。
>
> 凡 prompt 字面文本、模型 API 参数,沿用 `design.md` 既有约定:**不在本文锁死**,实施时查火山/DeepSeek 官方文档(`design.md §2.5`)。

---

## 1. v2 端点请求 / 响应 schema

所有端点鉴权同 `contract.md §7`:`Authorization: Bearer <AGENT_SHARED_SECRET>` + `X-Request-Id`。错误码见 §1.6。契约落在新文件 `packages/contracts/src/v2.ts`(TS 真相源)+ Python `schemas.py` 镜像。

> **强制约定 · strict / forbid(修复评审 P0-2)**:本文所有 `z.object({...})` **实际写为 `.strict()` 或 `strictObject(...)`**,并**递归套用到每一层嵌套对象**(zod `.strict()` 只作用于当前层,不自动递归 → 嵌套的 `exif` / `meta` / `error` 等都要各自 `.strict()`)。默认 `z.object` 会 **strip** 未知字段而非拒绝,放任 `lat/lng` 静默通过 → **直接打破 D-GPS 隐私验收**。Python `schemas.py` 每个 model `model_config = ConfigDict(extra='forbid')`。下文为可读性省略 `.strict()` 后缀,但**落地必须带**;隐私相关的 `exif` 显式标注。

### 1.1 `POST /v2/album/init`(异步 202 + callback)

唯一携带 base64 的端点。预校验(同 `design.md §2.2`)通过后立刻 202,Stage 1+3 进 BackgroundTask。

```ts
// 请求体
export const V2InitRequest = z.object({
  requestId: z.string(),
  albumId: z.string(),
  callbackUrl: z.string().url(),
  language: z.enum(['zh', 'en']),
  // ★ 决策 D-GPS(architecture §8.1):v1 不抽 GPS → 无 includePlace 开关、无 lat/lng 字段
  meta: z.object({
    promptHint: z.string().max(500).optional(),  // 用户创建页可选一句话,作主题软提示
  }).optional(),
  photos: z.array(z.object({
    photoId: z.string().min(1),
    base64: z.string(),                      // data:image/(jpeg|png);base64,...  ≤800KB
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    exif: z.object({
      takenAt: z.string().datetime().nullable().optional(),   // ISO;低敏,可入库(唯一 EXIF 字段)
    }).strict().optional(),  // ★ .strict() 硬拒 lat/lng 等未知键(D-GPS 隐私验收的执行点,P0-2)
  })).min(1).max(30),
});

// 202 接单响应(同 contract.md §2.1)
{ "ok": true, "data": { "requestId": "...", "accepted": true } }
```

**callback —— 专用 v2 envelope,不复用 v1 严格 union**(修复:v1 `completed` 必带 `layout` 且 `extra='forbid'`,塞 `draftTree` 会破坏 union;`contract.md §2.1` / `design.md §8`)。v2 callback 发往**独立路由** `POST /api/v2/internal/job-progress`,用 `jobKind` 判别符,init 与 finalize 的 `completed` 载荷形状互斥:

```ts
// packages/contracts/src/v2.ts —— 三 variant 各自 extra='forbid'(Python 镜像同)
const V2ProgressEvent  = z.object({ requestId:z.string(), jobKind:z.enum(['init','finalize']),
  event:z.literal('progress'), stage:z.string(), progress:z.number().min(0).max(100),
  message:z.string().optional() });
const V2InitCompleted   = z.object({ requestId:z.string(), jobKind:z.literal('init'),
  event:z.literal('completed'), draftTree:AlbumDraft /* §2 */, usage:Usage });
const V2FinalizeCompleted = z.object({ requestId:z.string(), jobKind:z.literal('finalize'),
  event:z.literal('completed'), layout:AlbumLayoutPlan /* layout.ts,对外契约 */, usage:Usage });
const V2FailedEvent    = z.object({ requestId:z.string(), jobKind:z.enum(['init','finalize']),
  event:z.literal('failed'), error:z.object({code:z.string(),message:z.string()}),
  stage:z.string().optional(), progress:z.number().optional() });

// ★ 不能用 z.discriminatedUnion('event', ...):两个 variant 同为 event:'completed',
//   单 discriminator 接两个同值分支 zod/pydantic 都不合法(修复评审 P0-1)。
//   两级:completed 内部按 jobKind 判别,外层普通 union(progress/failed 试匹配)。
const V2Completed = z.discriminatedUnion('jobKind', [V2InitCompleted, V2FinalizeCompleted]);
export const V2Callback = z.union([V2ProgressEvent, V2FailedEvent, V2Completed]);
// route 必须再断言 payload.jobKind === agent_jobs.kind(防 init job 收到 finalize 形状的回调)
```
> 所有 variant 用 `.strict()`(见下方 P0-2 约定);Python 镜像每个 model `extra='forbid'`,且在 handler 里硬校验 `payload.jobKind == job.kind && payload.requestId == job.request_id`。

- init progress `stage ∈ {'vision','grouping','skeleton','writing'}`;finalize progress `stage='finalize'`(`contract.md §5` 进度语义沿用)。
  - **`'writing'`(#161,架构师已批准):** init 在 `skeleton` 之后、`completed` 之前直接批量写第一版全部文案(自动定主题 + 封面文案 + 各章正文,**去掉逐章对话写作的主题确认步**),封面 + N 章用 `asyncio.Semaphore`(上限 `INIT_WRITE_CONCURRENCY`,默认 3)并发写;任一失败 → init `FAILED` + 释放 hold(沿用 §1.1 `init/failed` 退款路径)。stage 顺序:`vision → grouping → skeleton → writing`。`V2JobStage` 枚举随之加 `'writing'`(`v2.ts` / `schemas_v2.py` 同步)。
- **Web `/api/v2/internal/job-progress` 路由**:`switch(jobKind, event)`——
  - `init/completed` → 写 `albums.draft_json` + `status=EDITING`(草稿就绪,`layout_json` 仍 null),hold 维持,**不 settle**。
  - `finalize/completed` → 见 §1.4。
  - `*/progress` → 更新 `agent_jobs.stage/progress`(按 `kind`)。
  - `init/failed` → album `FAILED` + `release`;`finalize/failed` → album 回 `EDITING` + 保留 hold(§5)。
- 幂等同 `contract.md §9.2`(`agent_jobs.status` 已终态则直接 200)。**v1 路由 `/api/v1/internal/job-progress` 连同 `/v1/layout`、`/v1/chat-edit` 在 v2 cutover 同 PR 删除**(D-V1Kill,architecture §0/§7),不保留。

### 1.2 `POST /v2/album/theme`(同步)

```ts
export const V2ThemeRequest = z.object({
  albumId: z.string(),
  language: z.enum(['zh', 'en']),
  clustersOverview: z.array(z.object({       // 各章概览,Web 从 draft_json 摘要,无 base64
    chapterId: z.string(),
    label: z.string(),
    place: z.string().nullable().optional(), // 粗地名
    timeRange: z.string().nullable().optional(),
    photoDescs: z.array(z.string()).max(8),  // 代表图 description 摘要
  })).min(1),
  currentTheme: V2Theme.optional(),          // 已有主题(改主题时回传)
  userMessage: z.string().max(500).optional(),  // 用户对主题的话;空=让 AI 提议
});

export const V2Theme = z.object({
  subject: z.string(),
  occasion: z.string().optional(),
  timeframe: z.string().optional(),
  tone: z.string(),
  style: z.enum(['warm-film','editorial-mono','soft-pastel','bold-contrast','vintage-print']),
});

// 200 响应
export const V2ThemeResponse = z.object({
  theme: V2Theme,
  cover: z.object({                          // 可选:立即出封面草案
    templateId: z.string(),                  // cover 类:mag-01 | mag-13 | p01 | mag-20(纯文字)
    texts: z.record(z.string(), z.string()),
    heroPhotoId: z.string().nullable(),      // 选作封面图的 photoId(纯文字封面为 null)
  }).optional(),
  assistantReply: z.string().max(500),
  usage: Usage,
});
```

Web 持久化:`theme` merge 进 `draft_json.meta.theme + meta.style`;`cover` merge 进 `draft_json.basePages.cover`。

### 1.3 `POST /v2/album/chapter-chat`(同步)

只送**本章**切片(架构 §3)。

```ts
export const V2ChapterChatRequest = z.object({
  albumId: z.string(),
  language: z.enum(['zh', 'en']),
  theme: V2Theme.optional(),                 // 全局基调约束(主题先行)
  chapter: z.object({
    chapterId: z.string(),
    state: V2ChapterState,                   // §5 状态枚举
    cluster: z.object({ label:z.string(), place:z.string().nullable().optional(),
                        timeRange:z.string().nullable().optional(),
                        role:z.enum(['opening','body','closing']) }),
    photos: z.array(V2PhotoAnalysis),        // 本章照片 analysis(纯文本,无 base64)
    brief: V2Brief.optional(),
    pages: z.array(Page),                     // 本章骨架页(图已就位,texts 待填)
  }),
  history: z.array(z.object({ role:z.enum(['user','assistant']), content:z.string() })).max(20),
  userMessage: z.string().max(500),
});

// 200 响应
export const V2ChapterChatResponse = z.object({
  assistantReply: z.string().min(1).max(500),
  chapterBrief: V2Brief.optional(),          // intake 蒸馏(有更新时给)
  state: V2ChapterState,                     // 推进后的状态
  pagesTexts: z.array(z.object({             // 只回本章各页 texts(图不变)
    pageIndex: z.number().int().nonnegative(),
    texts: z.record(z.string(), z.string()),
  })).optional(),                            // brief_ready/skipped 生成文案时给
  usage: Usage,
});

export const V2Brief = z.object({
  userWords: z.string().optional(),
  factNote: z.string().optional(),           // 用户提供的事实(扩写依据)
  mood: z.string().optional(),
});
export const V2ChapterState = z.enum(['empty','asking','brief_ready','generated','skipped','finalized']);
```

Web 持久化:`pagesTexts` merge 进该 chapter 的 `pages[].texts`;`chapterBrief`/`state` 更新该 chapter;user + assistant 各写一行 `album_messages(chapter_id=chapterId)`。

### 1.4 `POST /v2/album/finalize`(异步 202 + callback)

```ts
export const V2FinalizeRequest = z.object({
  requestId: z.string(),
  albumId: z.string(),
  callbackUrl: z.string().url(),
  draftTree: AlbumDraft,                      // 整棵树(无 base64),§2
});
// 202: { ok:true, data:{ requestId, accepted:true } }
```

> **接单前置(Web 侧,硬)**:抢锁 `UPDATE albums SET status='AGENT_RUNNING' WHERE id=? AND status='EDITING' AND draft_json IS NOT NULL AND layout_json IS NULL`,影响 0 行 → 409 `ALBUM_NOT_EDITABLE`(防重复 finalize 撞 `album_pages` 唯一索引,P1-5)。抢到锁后**同事务补 hold**:无 active HOLDING → precheck + 新 hold + 重指 `credit_hold_id`(P1-6,§12.1)。详见 §11 / §12.1。

**callback** — `jobKind='finalize'`,`completed` 载荷是**扁平 `AlbumLayoutPlan`**(对外契约,不变),走同一 `V2Callback`(§1.1):

```ts
{ requestId, jobKind:'finalize', event:'progress',  stage:'finalize', progress:0-100 }
{ requestId, jobKind:'finalize', event:'completed', layout: AlbumLayoutPlan, usage }
{ requestId, jobKind:'finalize', event:'failed',    error, stage?, progress? }
```

> Web `/api/v2/internal/job-progress`(`jobKind=finalize`):
> - `completed` → zod 校验 layout(不变式 9)→ **一个事务**:写 `album_pages` + `albums.layout_json` + `albums.status='EDITING'`(已 finalized,可编辑/导出)+ `creditService.settle(hold)`。**不置 `COMPLETED`**——`COMPLETED` 仍由 PDF 上传确认负责(`docs/web/api.md §3.6/§3.7`)。
> - `failed` / 超时 → `albums.status='EDITING'`(草稿仍在,`draft_json` 不动)+ **hold 维持 HOLDING**,可重试 finalize,**不 release、不 FAILED**。这与 `kind=init` 失败相反,故 callback handler 与 zombie sweeper 都按 `agent_jobs.kind` 分流(§5 / §12)。

### 1.5 `POST /v2/album/edit`(同步,Stage 6)

作用于 finalized 扁平 layout = `/v1/chat-edit` 超集 + pickTemplate Tool。

```ts
export const V2EditRequest = z.object({
  albumId: z.string(),
  currentLayout: AlbumLayoutPlan,            // 扁平,通过 zod
  history: z.array(...).max(20),
  userMessage: z.string().max(500),
  language: z.enum(['zh','en']),
});
// 200: { ok:true, data: V2EditResponse }   ← TS 真相源见 §2(layoutPatch ≤48 / assistantReply / usage)
```

换版时,Agent 内部调 `pickTemplate('chapter', imageCount, photos, exclude, ...)`(§4.3,带 useCase)产生合法 templateId,整页替换 `templateId+images+texts` 进 patch。校验/repair 同 `design.md §13.5`(patch 应用后整 layout 仍过 `validate_v2`,含 §4.4 的 cover/ending hero 豁免)。

### 1.6 错误码(v2 场景 → 既有 code 的映射)

**两套命名空间必须先对齐(修复评审 P2-8)**:Agent 内部 code(`contract.md §8`,如 `AGENT_OUTPUT_VALIDATION`)与 Web 的 `apps/web/src/lib/api/error-codes.ts`(实际是 `AGENT_INVALID_OUTPUT`,且**无 `ALBUM_BUSY`**)不一致。施工前二选一统一,本文采用**「Agent 发 contract.md §8 名,Web 入站时映射到 error-codes.ts 名」**,并补齐缺口:

- `AGENT_OUTPUT_VALIDATION`(Agent)→ **`AGENT_INVALID_OUTPUT`**(Web,已存在)。
- album 忙/不可 finalize 的冲突 → 复用既有 **`ALBUM_NOT_EDITABLE`(409)**(error-codes.ts 已有),**不引入 `ALBUM_BUSY`**。
- 并发编辑冲突沿用既有 **`CHAT_BUSY`(409)**。
- 余额不足沿用 **`CREDIT_INSUFFICIENT`(402)**。

下表为 **Agent 端发出**的 code(Web 映射后见括注):

| 场景 | Agent code | HTTP | Web 映射 |
|---|---|---|---|
| init Stage 1 失败 | `AGENT_VISION_FAILED` | 502 | 同名 |
| init Stage 3 排骨架异常(理论不应发生,确定性引擎) | `AGENT_OUTPUT_VALIDATION` | 502 | `AGENT_INVALID_OUTPUT` |
| theme / chapter-chat DeepSeek 失败 | `AGENT_PLANNING_FAILED` | 502 | 同名 |
| finalize 补文/收尾失败 | `AGENT_PLANNING_FAILED` | 502 | 同名 |
| finalize 拍平后 layout 校验失败(含 photoId>2 次越界)| `AGENT_OUTPUT_VALIDATION` | 502 | `AGENT_INVALID_OUTPUT` |
| edit patch 失败 | `AGENT_CHAT_FAILED` | 502/504 | 同名 |
| init/finalize 后台超时(>180s) | `AGENT_TIMEOUT` | callback failed | 同名 |
| 同 album 同 kind 互斥 / 非 EDITING 提交 finalize | (Web 本地)| 409 | `ALBUM_NOT_EDITABLE` |

---

## 2. `draft_json` 的 JSON 形状(完整 zod)

落在 `packages/contracts/src/v2.ts`(TS 真相源),Python `schemas.py` 镜像。

```ts
import { z } from 'zod';
import { Page } from './layout';   // 复用现有扁平 Page{pageIndex,templateId,images,texts}

// V2PhotoAnalysis —— authoring 期【内部】结构,扩充字段仅用于分组/排版/配文。
// ★ 不修改 packages/contracts/src/layout.ts 的 PhotoAnalysis(对外契约保持 5 字段,需求 §7)。
// ★ 扩充字段(peopleCount/scene/mood/timeOfDay)是内部辅助,finalize 时显式 strip,
//    绝不进入对外扁平 AlbumLayoutPlan.photos。基础 5 字段沿用 layout.ts 同名同形。
//   (这也意味着不动 D-13/D-3 的"清漂移":那是独立的 v2 backlog 记账项,本次不碰 layout.ts。)
export const V2PhotoAnalysis = z.object({
  // —— 基础 5 字段:与 layout.ts PhotoAnalysis 同形,finalize 直接保留 ——
  photoId: z.string().min(1),
  description: z.string(),
  tags: z.array(z.string()),
  quality: z.enum(['hero','detail','fill']),
  orientation: z.enum(['portrait','landscape','square']),
  // —— 扩充字段:内部辅助,finalize strip ——
  peopleCount: z.enum(['0','1','2-3','4+']),
  scene: z.enum(['indoor','outdoor','nature','city','interior']),
  mood: z.enum(['warm','cool','sentimental','energetic','quiet']),
  timeOfDay: z.enum(['morning','day','evening','night']).nullable().optional(),
});

export const V2Photo = z.object({
  photoId: z.string().min(1),
  analysis: V2PhotoAnalysis,
  exif: z.object({
    takenAt: z.string().datetime().nullable().optional(),   // 低敏,入库
    place: z.string().nullable().optional(),                // ★ v1 恒 null(D-GPS,不抽 GPS);字段保留供 v2 启用地点时复用,原始 lat/lng 永不在此
    order: z.number().int().nonnegative(),                  // 上传序,EXIF 缺失时排序兜底
  }),
  duplicateOf: z.string().nullable().optional(),            // 指向代表图 photoId
  used: z.boolean(),                                        // 重复簇非代表图 = false,折叠不删
});

export const V2Cluster = z.object({
  label: z.string(),
  timeRange: z.string().nullable().optional(),
  place: z.string().nullable().optional(),
  role: z.enum(['opening','body','closing']),
});

export const V2Chapter = z.object({
  chapterId: z.string().min(1),
  state: z.enum(['empty','asking','brief_ready','generated','skipped','finalized']),
  cluster: V2Cluster,
  photoIds: z.array(z.string()),              // 同组永远在一起;指向 used=true 的 photo
  brief: z.object({
    userWords: z.string().optional(),
    factNote: z.string().optional(),
    mood: z.string().optional(),
  }).optional(),
  askCount: z.number().int().nonnegative().default(0),   // 已追问轮数,≥2 自动前进(§5)
  pages: z.array(Page),                       // Stage3 填 templateId+images;Stage4 填 texts
});

export const AlbumDraft = z.object({
  version: z.literal('v2'),
  meta: z.object({
    theme: V2Theme.partial().optional(),      // Stage2 前可能只有 promptHint
    style: z.enum(['warm-film','editorial-mono','soft-pastel','bold-contrast','vintage-print'])
            .default('warm-film'),
    language: z.enum(['zh','en']),
    promptHint: z.string().max(500).optional(),
  }),
  photoPool: z.array(V2Photo),
  basePages: z.object({
    cover: Page,                              // 必有;init 给默认 cover 模板+hero 图
    toc: Page.nullable().optional(),          // 章数≥4 且 总页≥8 才有(§4.4)
    ending: Page,                             // 固定 closing 模板 mag-17
  }),
  chapters: z.array(V2Chapter),
});
export type AlbumDraft = z.infer<typeof AlbumDraft>;
```

**finalize 拍平**(确定性,§5.2)产出 `AlbumLayoutPlan`(`layout.ts`),其 `photos: PhotoAnalysis[]` 用现有 5 字段基础版(`V2PhotoAnalysis` 显式 strip 扩充字段,向后兼容渲染器),`pages` 重排 `pageIndex` 0..N-1。

**edit / chat 契约(TS 真相源,修复 D-13 漂移)**——`/v2/album/edit`(§1.5)与 `Usage` 必须在 TS 侧落地,Web 与 Agent 同源消费(不再只活在 Python `schemas.py`):

```ts
// packages/contracts/src/v2.ts(或 chat.ts,二选一,index.ts 导出)
export const Usage = z.object({               // 统一 usage,init/theme/chapter-chat/finalize/edit 共用
  durationMs: z.number().int().nonnegative(),
  visionCallCount: z.number().int().nonnegative().default(0),
  planningInputTokens: z.number().int().nonnegative().default(0),
  planningOutputTokens: z.number().int().nonnegative().default(0),
  repairAttempts: z.number().int().nonnegative().default(0),
  models: z.object({ vision: z.string().optional(), planning: z.string().optional() }),
});
export const LayoutPatchEntry = z.object({
  pageIndex: z.number().int().nonnegative(),
  templateId: z.string().optional(),
  images: z.record(z.string(), z.string()).optional(),
  texts: z.record(z.string(), z.string()).optional(),
});
export const V2EditResponse = z.object({
  layoutPatch: z.array(LayoutPatchEntry).min(1).max(48),   // 上限对齐 §5.2 v2 页数边界
  assistantReply: z.string().min(1).max(500),
  usage: Usage,
});
```

> Python `schemas.py` 镜像这三者(`extra='forbid'`);Web 直接 `import` TS 类型消费 patch。这清掉 `design.md §14` 表里的 D-13(chat 契约只在 Python)记账项——**仅就 v2 edit 范围内**,不回填 v1 chat-edit 的历史漂移。

---

## 3. Stage 1 · 分批识图 + 分组 + 去重算法

输入:`photos[{photoId, base64, width, height, exif{takenAt?}}]`(v1 无坐标,D-GPS)。
输出:`photoPool[]`(含 analysis / place / duplicateOf / used)+ `chapters[]`(分组结果,含 cluster)。

### 3.1 GPS:v1 完全不抽取(决策 D-GPS,architecture §8.1)

**v1 不做地点分组,坐标根本不进入系统**——这比"抽 GPS 后反查即弃"更简单、隐私风险为零:

- **浏览器 Stage 0**:只读 `takenAt`,不读 GPS 字段;payload 的 `exif` 仅 `{takenAt?}`,无 `lat/lng`。
- **无 `includePlace` 开关**(创建页不出现"包含地点信息");无 `reverse_geocode` / `geocode.py` 服务。
- **分组只用时间**(§3.3 切章去掉 `place_changed` 维度);`photoPool[].exif.place` 恒 null。
- **防御性红线仍在**:即便 v1 不抽 GPS,Agent 入参 schema 不含 lat/lng(误传即被 `extra='forbid'` 拒),structlog redact 列表仍保留 `lat/lng/latitude/longitude/gps/coordinates/place`(防未来回归)。
- **未来恢复 GPS**(v2 backlog):按不变式 11 预置红线施工——原始坐标用一次反查即弃、只存粗 place、绝不入库/日志。届时再引入 `geocode.py`(优先离线粗 city 库,接外部 API 需另过隐私评审)。
- 测试 `test_v2_privacy_redact.py`:断言 ① init 入参拒收 lat/lng(schema 层);② pool 内无任何坐标、`place` 全 null;③ 日志快照不含坐标/base64 片段。

### 3.2 分批识图(成本优化)

```
# 主键排序:takenAt 优先,缺失退回上传序 order
sorted = stable_sort(photos, key = (takenAt or +inf-with-order-tiebreak, order))
# 按 EXIF 时间分批,每批 10~15 张(token 大头),批间并行
batches = chunk_by_time_window(sorted, target_size=12, max_size=15)
analyses = parallel_map(batches, lambda b: vision_call(b))   # 火山一次多图(design §2.1)
# vision_call 内:严格 JSON 数组,长度==批大小,顺序对齐,Agent 回填 photoId(design §2.4)
# 任一批失败 → retry 1 → 仍失败 → AGENT_VISION_FAILED(整体失败,design §1.2)
```
- 每张产出 `analysis{desc,tags,quality,orientation,mood,scene,peopleCount,timeOfDay?}` + 批内 `groupHint`(段内语义细分标签)+ 批内 `duplicateOf`(VLM 判同批重复)。三件事一次调用出(需求 §6)。

### 3.3 分组(全局主键 = EXIF 时间,VLM 只段内细分;v1 无地点维度)

```
# ★ 先把"有 takenAt"与"无 takenAt"分成两条独立队列,
#   避免无时间图进入时间 gap 比较(修复评审 M3:gap(None, ...) 未定义)
timed   = [p for p in photos if p.exif.takenAt is not None]   # 按 takenAt 升序、order 次序
untimed = [p for p in photos if p.exif.takenAt is None]       # 按 groupHint 聚类、order 次序

# ① 全局切章:只对 timed 队列,按 takenAt 间隔(v1 无 place 维度,D-GPS)
chapters = []
cur = None
for p in sort(timed, key=(takenAt, order)):
    if cur is None or gap(p.takenAt, cur.last.takenAt) > TIME_GAP_THRESHOLD:  # 默认 6h,可调
        cur = new_chapter(); chapters.append(cur)
    cur.add(p)

# ② 段内细分:VLM groupHint 只在"同一时间段内"再切(不跨批合并)
for ch in list(chapters):
    if len(ch) 较大 and groupHints 在段内分化明显:
        replace ch with split_by_groupHint(ch)     # 仅细分,不合并跨段

# ③ 无 takenAt 的照片:按 groupHint + 上传序成独立章,挂到时间轴末尾(需求 §6)
for cluster in cluster_by_groupHint(sort(untimed, key=order)):
    chapters.append(new_chapter(cluster))

# ④(去重之后再做)清理 + 角色标注 —— 见 §3.4 末尾
```
- **跨批冲突消解**:VLM groupHint 只在同一时间段内有效,**不负责跨批合并** → 天然无跨批冲突(需求 §6)。
- 阈值 `TIME_GAP_THRESHOLD` 可调(需求 §4.5 同精神),默认 6h。
- 角色标注**必须放在去重清理之后**(§3.4),否则空章被删后 opening/closing 会标错。

### 3.4 去重(批内 VLM + 跨批确定性二次扫描)

```
# 批内:VLM 已给 duplicateOf(同批)
# 跨批:仅确定性二次扫描兜底(需求 §6;embedding 留 v2)
for (a, b) in cross_batch_candidate_pairs:        # 仅相邻时间窗内配对
    if a.takenAt and b.takenAt
       and abs(a.takenAt - b.takenAt) < DUP_SECONDS        # 默认 3s
       and jaccard(a.tags, b.tags) > TAG_OVERLAP:          # 默认 0.8
        mark b.duplicateOf = a.photoId
# 无 EXIF 时间 → 放弃跨批判重(接受偶发重复,需求 §6)

# 每重复簇保留 1 张代表图(VLM 在批内已选 best;跨批取 takenAt/质量更优者)
for cluster in duplicate_clusters:
    rep = pick_best(cluster)        # quality=hero > detail > fill,次按构图
    rep.used = True
    for other in cluster - {rep}: other.used = False; other.duplicateOf = rep.photoId
# 章的 photoIds 只收 used=True 的照片(折叠的非代表图留在 photoPool,不进任何章的 photoIds)

# ★ 去重后清理(修复评审 M3):某章全部照片都被折叠成别章代表图的副本 → used 数=0 → 删空章
chapters = [ch for ch in chapters if any(p.used for p in ch.photos)]
# ★ 角色标注放在清理之后:首章 opening、末章 closing、其余 body(供 Stage5 收尾)
if chapters:
    for ch in chapters: ch.cluster.role = 'body'
    chapters[0].cluster.role  = 'opening'
    chapters[-1].cluster.role = 'closing'
```
- **代表图跨章**:若 b 的代表图 a 在另一章,b 仍留在自己原章的 `photoPool` 视图里但 `used=false`,不计入任一章 `photoIds`;representative a 只在 a 所在章出现一次,满足"每张 used 照片在其章内恰好一次"(需求 §4.4)。

### 3.5 纠错入口(需求 §6 / §10.2)

- 分组结果在 init 完成后由 Web 在对话里显式呈现让用户确认。
- 用户拖图换组 / 合并 / 拆分 → **Web 改 `draft_json` 的 chapters + photoIds → 调内部"重排受影响章"**(确定性,零 LLM,零计费):对受影响章重跑 §4 的 partition + pickTemplate。该重排可做成 Agent 的一个轻确定性端点或 Web 侧复用同一份 partition/pickTemplate 库(二者共享 `packages/contracts/templates`)。**裁定**:放 Web 侧 TS 实现(确定性、无模型、避免一次网络往返),Agent 与 Web 共用同一套 partition/pickTemplate 规范(本文 §4 即规范),**并由 `packages/contracts/fixtures/skeleton/*.json` 共享 golden fixtures 强制两端输出字节一致**(§9.2,防双实现漂移)。

---

## 4. Stage 3 · 确定性骨架排版

零 LLM、零 token。引擎硬保证(需求 §4.4):每槽填满、每张 `used=true` 照片在其章内恰好出现一次、同页不重复、页数合理。

### 4.1 模板索引:必须按 (useCase, 图片槽数) 双维度,不能只按槽数(修复评审 B6)

由 `packages/contracts/templates/*.json` 实际内容派生(21 个模板)。**只按槽数取候选会让正文 1-up 误选到封面/尾页模板**(1 槽集合里混着 mag-01/13/p01 封面与 mag-17 尾页)。故候选索引 `TEMPLATES_BY[useCase][imageCount]`,`useCase ∈ {chapter, cover, toc, closing}`:

| useCase | 图片槽数 | 模板候选(真实) | 数量 |
|---|---|---|---|
| **chapter** | 1(1-up) | mag-03, mag-05, mag-06, mag-08, mag-11, mag-19 | 6 |
| **chapter** | 2(2-up) | mag-07, mag-09, mag-12, mag-15, mag-18 | 5 |
| **chapter** | 3(3-up) | **mag-04, mag-16** | **2** |
| **chapter** | 0(纯文字叙事) | mag-14 | 1 |
| **cover** | 1(图文封面) | mag-01, mag-13, p01 | 3 |
| **cover** | 0(纯文字封面) | mag-20 | 1 |
| **toc** | 0(目录,`items` 数组槽) | **mag-02** | 1 |
| **closing** | 1(尾页,固定) | **mag-17** | 1 |
| (未用) | 4(4-up) | mag-10 | 1 |

**每槽数的 fill 容量上限**(= 该 useCase 下所有候选模板中"非 hero 槽"个数的最大值;hero 槽 = quality 含 `hero`,禁放 fill 图,需求 §4.3):

| 图片槽数 | chapter 候选里最大 fill 容量 | 来源 |
|---|---|---|
| 1 | **1** | mag-19(单槽 `['detail','fill']`,非 hero);mag-03/05/06/08/11 是 hero 槽 → 容量 0 |
| 2 | **2** | mag-18(两槽都 `['detail','fill']`);mag-07/09/12/15 各 1 个 hero 槽 → 容量 1 |
| 3 | **2** | mag-04 / mag-16 都是 1 hero 槽 + 2 非 hero 槽 → 容量 2 |

> ⚠️ **核心约束(决定 partition)**:`capacity[1]=1, capacity[2]=2, capacity[3]=2`。**一个 3 图页若全是 fill,没有任何 3-up 模板能合法容纳(都只剩 2 个非 hero 槽)** → 必须在 partition 阶段就避免出现"3 fill 同页"(§4.2),否则 pickTemplate 候选空集崩溃(评审 B5)。
> **施工须知(候选稀疏)**:partition 只产 size ∈ {1,2,3}(从不产 4),mag-10 经确定性路径不可达,仅 edit 换版可用。3-up 仅 2 候选,exclude(避重)易耗尽 → pickTemplate 候选空集时**放宽 exclude**(§4.3),但因 partition 已保证 fill 可行性,`can_place` 后的集合**永不为空**。

### 4.2 partition(分页)伪代码

```python
def partition(chapter_photos):
    # § 需求 4.3:hero 各占一页(每章最多 1 张当 solo);其余每页 3 张,余数特殊处理
    heroes = [p for p in chapter_photos if p.analysis.quality == 'hero']
    solo   = heroes[0] if heroes else None          # 每章最多 1 张 hero solo
    rest   = [p for p in chapter_photos if p is not solo]  # 多出的 hero 退化为 detail 参与 partition

    sizes = []
    if solo is not None:
        sizes.append([solo])                        # 1-up(hero solo,首页位)

    n = len(rest)
    if   n == 0: pass
    elif n == 1: sizes.append(_take(rest, 1))       # 单图 → 1-up
    elif n == 2: sizes.append(_take(rest, 2))       # → 2-up
    else:
        q, r = divmod(n, 3)
        if   r == 0: page_sizes = [3] * q
        elif r == 1: page_sizes = [3] * (q - 1) + [2, 2]   # 余1 → 末两页 2+2
        else:        page_sizes = [3] * q + [2]            # 余2 → 多一个 2 页
        for s in page_sizes:
            sizes.append(_take(rest, s))

    pages = sizes   # List[List[Photo]],每页张数 ∈ {1,2,3},优先 3

    # ★ 容量可行性修复(修复评审 B5):某页 fill 图数 > capacity[页大小] → 没有合法模板能容纳
    #   规则:capacity[1]=1, capacity[2]=2, capacity[3]=2(§4.1)
    #   唯一会越界的是 size==3 且 3 张全 fill(fill=3 > 2)→ 拆成 2+1(2 页 fill≤2 ✓,1 页 fill=1 ✓)
    repaired = []
    for pg in pages:
        f = sum(1 for p in pg if p.analysis.quality == 'fill')
        if len(pg) == 3 and f == 3:
            repaired.append(pg[:2]); repaired.append(pg[2:])   # 2-fill 页(→mag-18)+ 1-fill 页(→mag-19)
        else:
            repaired.append(pg)        # size≤2 或 fill≤2 都已可行
    return repaired
```
- `quality=hero` 判定来自 VLM(`design.md §5.1.1`)。无 hero 的章不强制 solo(需求 §4.3)。
- 修复后**不变量**:每页 `fill_count ≤ capacity[len(page)]` 恒成立 → §4.3 `can_place` 过滤后候选集**保证非空**,绝不空槽、绝不崩溃(对齐需求 §11"1/2/10/30 不报错不空槽")。
- 拆分只在"3 张全 fill"这一种退化情形发生(罕见:hero/detail 图占多数时不触发),代价是该章 +1 页,可接受。
- 可调:每页目标 3、每章 hero solo 上限 1(需求 §4.5)。

### 4.3 pickTemplate(含 seed)伪代码

```python
def pickTemplate(use_case, image_count, photos, exclude, album_id, chapter_id, page_ordinal, attempt=0):
    # use_case ∈ {'chapter','cover','toc','closing'}  ← 必带,防止 1-up 误选封面/尾页(评审 B6)
    # photos: 本页要放的照片(len == image_count);exclude: 本章/相邻页刚用过的 templateId
    candidates = TEMPLATES_BY[use_case][image_count]       # (useCase, 槽数)双维度精确匹配(§4.1 表)

    # 唯一硬线(需求 §4.3 / design §5.1):fill 图不进 hero 槽 → Hall 可行性
    def can_place(t):
        fill_n  = sum(1 for p in photos if p.analysis.quality == 'fill')
        fill_ok = sum(1 for s in t.image_slots
                        if not ('hero' in s.quality and 'fill' not in s.quality))
        return fill_n <= fill_ok        # 非 fill 图可进任意槽;只需 fill 图能塞进非 hero 槽
    candidates = [t for t in candidates if can_place(t)]
    # ★ partition(§4.2)已保证 fill_count ≤ capacity[image_count],故 chapter 路径下此处永不空集

    # 避重:滤掉本章/相邻页刚用过的;若耗尽 → 优雅降级放宽(3-up 候选稀疏)
    pool = [t for t in candidates if t.id not in exclude] or candidates

    # 合法集内按 seed 随机:可复现 / 可撤销(需求 §4.3)
    seed = stable_hash(f"{album_id}:{chapter_id}:{page_ordinal}:{attempt}")
    chosen = pool[seed % len(pool)]
    return chosen.id     # reroll 时 attempt++ → 不同 seed → 可复现可撤销;结果存 Page.templateId
```
- **`use_case` 隔离**:chapter 1-up 只取 {mag-03,05,06,08,11,19},绝不会拿到 cover(mag-01/13/p01)或 closing(mag-17)。cover/toc/closing 各走自己的候选集(§4.4)。
- `image_count==0`:chapter 用 mag-14(纯文字叙事页,1-2 图兜底,对齐 `design.md §4.5`);cover 用 mag-20;toc 用 mag-02。
- 填图:`photos` 按 quality 降序、orientation 软偏好匹配 slot;`object-fit:cover` 吸收比例错配(架构 §6.6 决策 D-A)。每槽必填(引擎硬保证)。

### 4.4 basePages 与 TOC / 尾页(模板与图源全部钉死,修复评审 B8)

**复用预算(修复评审 P0-4)**:单张图全书 ≤2 次(`design.md §4.3`)。chapter 正文已用掉一部分,cover/ending **必须按剩余预算选图**,否则"只有 1 张 hero/detail"时 cover+正文+ending = 3 次会越界。

```python
# 先按 chapter 正文统计每张已用次数
use_count = Counter(pid for ch in chapters for pg in ch.pages for pid in pg.images.values())
def budget_ok(p): return use_count[p.photoId] < 2     # 还能再用一次
# 分配顺序:ending 先(强制带图,无替代模板)→ cover 后(可退化纯文字)→ 让稀缺预算优先保 ending
```

**ending**(尾页,固定 closing = mag-17,**1 图片槽,quality=['hero','detail'] 是 hero 槽**):
```python
ending.templateId = 'mag-17'
cand = [p for p in pool if p.used and p.analysis.quality in ('hero','detail') and budget_ok(p)]
pick = best(cand) if cand else (best([p for p in pool if p.used and budget_ok(p)])  # 预算内任意图
                                or best([p for p in pool if p.used]))  # 极端:全达上限时仍须填(见豁免)
ending.images = { 'image': pick.photoId }; use_count[pick.photoId] += 1
ending.texts.name1/name2 = Stage5 收束语(混合制,§5.2)
```

**cover**:
```python
cand = [p for p in pool if p.used and p.analysis.quality in ('hero','detail') and budget_ok(p)]
if cand:
    pick = best(cand)
    cover.templateId = pickTemplate('cover', 1, [pick], exclude=[], ...)   # mag-01/13/p01
    cover.images = { slot0: pick.photoId }; use_count[pick.photoId] += 1
else:
    cover.templateId = 'mag-20'; cover.images = {}     # ★ 无预算内合格图 → 纯文字封面(含"只有1张图"情形)
# init 先给默认 cover(模板+图或纯文字+空 texts);theme 阶段填/换 texts(§1.2)
```
> **1 张图的算账**:正文 1-up 用 1 次 → ending 用第 2 次 → cover 无预算 → 走 mag-20 纯文字。合计该图恰 2 次,满足 ≤2(正是评审 P0-4 的建议)。

**toc**(目录):
```python
def needs_toc(chapters, total_pages):
    return len(chapters) >= 4 and total_pages >= 8     # 阈值可调(需求 §4.3/§4.5)
# 指定模板 = mag-02(纯文字 spread,有 `items` 数组文本槽,天然适配章节列表)
# ★ Page.texts 是 Record<string,string>(layout.ts),不能塞数组(修复评审 P0-3)。
#   array 槽必须用扁平 bracket-path 键,由 adapt-layout.ts 重建成数组对象:
toc.templateId = 'mag-02'
toc.images = {}
toc.texts = {}
for i, ch in enumerate(chapters):
    toc.texts[f'items[{i}].title'] = ch.cluster.label    # 扁平键,adapter 解析 items[i].title
    # 如模板 item 还有副字段(如 page 号),同样 items[{i}].page = str(...)
# 注:item 子字段名(title/…)以 mag-02 渲染组件的 TemplateArrayItem 类型为准,施工时对齐
```

> **裁定 · cover/ending 的 hero 豁免**:需求 §4.3"fill 不进 hero 槽"的硬校验**只作用于 chapter body 页**(那里有模板可选、有质量分级意义)。**cover 与 ending 是全书仅各一的框架页,必须渲染且无替代模板**(closing 仅 mag-17),故当全本无 hero/detail 图时,这两页豁免该硬线、放最佳可得图,由 center-cover 吸收(架构 §6.6 D-A)。此豁免写入 finalize 校验:校验器对 `pageIndex==cover` 与 `==ending` 跳过 fill-in-hero 检查。**chapter 页永不豁免**(由 §4.2 容量修复保证可行)。
> **reuse 计数**:见上方"复用预算"块——`use_count` 跨 cover/toc/chapters/ending 统计,选图只取 `budget_ok`(<2)者,ending 优先于 cover 占用稀缺预算;cover 无预算即退 mag-20。finalize `validate_v2` 仍兜底硬校验"任一 photoId 全书 ≤2 次",越界即 `AGENT_OUTPUT_VALIDATION`(Agent 端 → Web `AGENT_INVALID_OUTPUT`,§1.6)。

---

## 5. Stage 4 状态机 + Stage 5 finalize / 拍平

### 5.1 Stage 4 逐章状态机(需求 §5)

```
empty ──asking──▶ asking ──用户答──▶ brief_ready ──生成文案──▶ generated ──收尾──▶ finalized
  │                  │
  └─"直接生成剩余"/跳过─┴──────────────▶ skipped ──氛围文案──▶ generated
```
- chapter-chat 每轮:`askCount++`;`askCount >= 2`(默认,可调)自动前进(brief_ready 或 skipped),不纠缠(需求 §5)。
- `brief_ready`:有用户事实 → 事实扩写灌 `pages.texts`。
- `skipped`:**仅用照片 analysis 出安全氛围文案,不出现任何未由用户/EXIF 提供的专有名词**(需求 §10.3,验收可测)。
- 文案只生成本章(几百 token),绝不重吐整本(需求 §1.6)。

### 5.2 Stage 5 finalize(补全 + 收尾 + 拍平)

```python
def finalize(draft):
    # ⓪ 确保 theme 存在(修复评审 B7:用户跳过 /theme 直接 finalize 时 theme.subject 为空)
    if not (draft.meta.theme and draft.meta.theme.subject):
        draft.meta.theme = derive_default_theme(draft)   # 轻 LLM 从 clusters+promptHint 提议;
                                                          # LLM 不可用则确定性兜底:
                                                          # subject=promptHint or 首章 label,
                                                          # tone='warm', style=meta.style(默认 warm-film)
        ensure_cover(draft)        # theme 既定后补/换封面(§4.4),保证"全程不聊也能完成"(需求 §11)
    # ① 补全未聊章:state ∈ {empty, asking, skipped} → 走氛围文案(skipped 策略,不胡编 §10.3)
    for ch in draft.chapters:
        if ch.state not in ('generated','finalized'):
            ch.pages = fill_ambiance_texts(ch, draft.meta.theme)   # LLM scoped
            ch.state = 'generated'
    # ② 收尾 pass(全局,LLM):开篇页 / 真正的结尾页 / 基调一致 / 模板节奏不重复
    ending_text = write_ending(draft.meta.theme, closing_anchor=user_closing_words?)  # 混合制(§4.4)
    smooth_tone_and_template_rhythm(draft)     # 仅文案/换版微调,不动图分配
    # ③ TOC 决策(此时页数已定):mag-02,items=章标题列表(§4.4)
    draft.basePages.toc = build_toc(draft) if needs_toc(draft.chapters, total_pages(draft)) else None
    # ④ 拍平(确定性):树 → 扁平 pages[]
    flat_pages = [draft.basePages.cover]
    if draft.basePages.toc: flat_pages.append(draft.basePages.toc)
    for ch in draft.chapters: flat_pages += ch.pages
    flat_pages.append(draft.basePages.ending)
    for i, pg in enumerate(flat_pages): pg.pageIndex = i        # 重排 0..N-1
    layout = AlbumLayoutPlan(
        magazine = Magazine(title=draft.meta.theme.subject, subtitle=..., style=meta.style, language=meta.language),
        photos   = [strip_to_base5(p.analysis) for p in draft.photoPool if p.used],  # ★ strip 扩充字段
        pages    = flat_pages,
    )
    assert validate_v2(layout)         # 见下;失败 → AGENT_OUTPUT_VALIDATION
    return layout
```
- **页数边界(修复评审 M2)**:`design.md §4.3` 的 `pages.length ∈ [1,16]` 是 **v1 单次合成**的硬线。v2 按内容排页,30 张可能远超 16 页。`layout.ts` 的 zod **本就无上界**(`pages.min(1)`),16 上限只在 v1 业务校验里。**v2 finalize 用边界 `[1, 48]`**(30 张最坏≈全 1-up:30 内容页 + cover/toc/ending ≈ 33,48 留足余量),**且永不丢图**(每张 used 照片必在某章出现一次,需求 §4.4)。该边界只是防御性上界,不是相等公式。
- **校验 `validate_v2`**:`AlbumLayoutPlan` zod(不变式 9)+ `design.md §4.3` 硬规则,v2 调整:① 页数边界 [1,48];② fill-in-hero 检查**豁免 cover/ending 两页**(§4.4 裁定),chapter 页不豁免;③ **任一 photoId 全书出现 ≤2 次**(P0-4 复用预算的兜底硬校验);④ **首页 cover 判定用 `template.category=='cover'`**,不是 `design.md §4.3` 写的 `cover-` 前缀(真实 cover 模板是 mag-01/13/p01/mag-20,无该前缀)。其余(photoId 全覆盖、pageIndex 0..N-1 连续、模板存在、slot key 合法)不变。
- **树不进 layout**(不变式 12):`photos` 经 `strip_to_base5` 只留 5 字段,扩充字段不外泄;finalize 成功后 Web 置 **EDITING**(成品可编辑/导出),**不置 COMPLETED**(§1.4 / §5)。

---

## 6. 旧 album 兼容与回退

| 场景 | 处理 |
|---|---|
| 旧 v1 作品(`draft_json=null`) | 照旧渲染 `album_pages`;**编辑统一走 `/v2/album/edit`**(旧作品本就是扁平 layout);零数据迁移(需求 §9)。`/v1` 端点删除不影响旧作品(D-V1Kill) |
| v2 ≤2 张照片 | partition 自然产 1-up / 2-up;无合法图文模板时用纯文字叙事页(chapter useCase 的 mag-14)兜底(对齐 `design.md §4.5` 决策 6) |
| v2 init Stage1 失败(`kind=init`) | callback failed → album FAILED + release;前端「失败,未扣积分,可重试」;sweeper 同样按 `kind=init` 收尸 |
| finalize 失败/超时(`kind=finalize`) | album 回 EDITING,hold 维持 HOLDING,可重试 finalize;**与 init 失败相反,不 release/FAILED**(架构 §5) |
| 草稿 24h 未 finalize | **不能直接复用现有 recover-stuck**(它扫 stale `agent_jobs`,不是闲置草稿)→ 新增 draft-expiry sweep(§12)release hold(需求 §10.5) |
| 用户改分组 | Web 改 draft_json + 确定性重排受影响章(§3.5),免费、不计费 |
| Stage3 引擎理论上不应失败 | 若 partition/pickTemplate 抛错 → `AGENT_OUTPUT_VALIDATION`,记日志(无 fallback layout,引擎本应按构造成立) |

---

## 7. 契约落地与漂移清理

| 文件 | 动作 |
|---|---|
| `packages/contracts/src/v2.ts` | **新增**:`AlbumDraft` 及子 schema(§2)+ 5 端点 req/res(§1)+ `V2Callback`(jobKind 判别)+ `Usage`/`LayoutPatchEntry`/`V2EditResponse`(§2)。TS 真相源 |
| `packages/contracts/src/layout.ts` | **不动**(修复评审 B1:对外 `PhotoAnalysis` 保持 5 字段;扩充字段只在 `V2PhotoAnalysis`,finalize strip)。D-3/D-13 历史漂移**本次不碰**,仍是独立 backlog 记账项 |
| `packages/contracts/src/index.ts` | 导出 v2 |
| `apps/agent/src/schemas.py` | 镜像 v2 schema(每 model `extra='forbid'`);`V2Callback` = union(progress/failed)+ `jobKind` 判别的两个 completed(**非单 event discriminated**,P0-1);TS 侧对应 `.strict()`(P0-2) |
| `apps/web/src/lib/api/error-codes.ts` | **统一错误码(P2-8)**:Agent `AGENT_OUTPUT_VALIDATION`→Web `AGENT_INVALID_OUTPUT` 映射;并发冲突复用 `ALBUM_NOT_EDITABLE`(不加 `ALBUM_BUSY`) |
| `apps/agent/src/routes/` | 新增 `v2_album.py`(5 端点);**cutover 删除 `layout.py` / `chat_edit.py`**(D-V1Kill) |
| `apps/agent/src/services/` | 新增 `grouping.py`(§3)、`skeleton.py`(§4 partition/pickTemplate)、`theme.py`、`chapter_chat.py`、`finalize.py`;复用 `vision.py` / `ai_client.py` / `layout_rules.py` / `templates.py`。**v1 无 `geocode.py`**(D-GPS) |
| `apps/web/src/db/schema.ts` | 闸门2:`albums.draft_json jsonb`、`album_messages.chapter_id text` + index、**`agent_jobs.kind` enum + partial unique index `(album_id,kind) WHERE status IN ('QUEUED','RUNNING')`**(§8) |
| `apps/web` 路由 | 新增 `/api/v2/albums/*` 转发层(同 `agent-client.ts`);**新增 `/api/v2/internal/job-progress`** 路由,按 `switch(jobKind, event)` 分流(§1.1);**cutover 删除 `/api/v1/*` 旧路由 + `/v1/chat-edit` 调用**,编辑器改调 `/v2/album/edit` |
| `apps/web` 服务 | `albumService`/`jobService`:failed/zombie 按 `agent_jobs.kind` 分流(§5);新增 draft-expiry sweep(§12) |
| `docs/architecture.md §3` | 增补不变式 11 / 12;`design.md §9` 日志红线加 lat/lng/coordinates/place |

> **不新增顶层目录**(CLAUDE.md):v2 全部落在已登记的 `apps/agent/src/{routes,services}`、`packages/contracts/src`、`apps/web/src`。partition/pickTemplate 规范两端共用(Web TS 侧用于免费重排,Agent Python 侧用于 init/edit),以本文 §4 为单一规范源,并由 `packages/contracts/fixtures/skeleton/` 共享 golden fixtures 锁定两端一致(§9.2,P2-5)。

---

## 8. 数据库迁移(闸门 2)

```sql
-- drizzle migration
ALTER TABLE albums          ADD COLUMN draft_json  jsonb;          -- null = v1 作品
ALTER TABLE album_messages  ADD COLUMN chapter_id  text;           -- null = v1 chat 消息
CREATE INDEX idx_album_messages_album_chapter_created
  ON album_messages (album_id, chapter_id, created_at);

-- agent_jobs.kind:区分 init / finalize 两类异步 job(失败/收尸语义相反,§5)
CREATE TYPE agent_job_kind AS ENUM ('init', 'finalize');
ALTER TABLE agent_jobs ADD COLUMN kind agent_job_kind NOT NULL DEFAULT 'init';  -- 存量行默认 init

-- 同 album 同 kind 互斥的 DB 兜底(并发抢锁的第二道,§11 P1-7)
CREATE UNIQUE INDEX uq_agent_jobs_album_kind_active
  ON agent_jobs (album_id, kind) WHERE status IN ('QUEUED', 'RUNNING');
```
```ts
// drizzle schema.ts 对应
export const agentJobKindEnum = pgEnum('agent_job_kind', ['init', 'finalize']);
// agentJobs 增:kind: agentJobKindEnum('kind').notNull().default('init'),
// agentJobs 索引增:uniqueIndex('uq_agent_jobs_album_kind_active')
//   .on(t.albumId, t.kind).where(sql`status in ('QUEUED','RUNNING')`),
```
- 全部 nullable / 有 default,**对存量行零影响**(旧 album draft_json=null,旧消息 chapter_id=null,旧 job kind='init')。
- `albums.layout_json` / `album_pages` / `credit_holds` / `credit_ledger` / `albumStatusEnum` **不动**(finalize 复用 EDITING,不新增 album 状态)。

---

## 9. 测试验收(对齐需求 §11)

### 9.1 端到端验收(需求 §11 逐条)

| 需求 §11 | 测试 |
|---|---|
| 上传 1/2/10/30 张都能生成草稿(不报错、不空槽) | `test_v2_init_{1,2,10,30}.py`:断言 callback completed + draftTree;每章每页 image slot 全满(无空槽);used 照片各章恰一次 |
| 全程不聊天也能"直接完成"出完整册子 | `test_v2_finalize_no_chat.py`:init → **不调 /theme**直接 finalize → 断言 `derive_default_theme` 填了 `subject`、cover 非空、layout 过校验、pages 连续、cover/ending 齐(覆盖评审 B7) |
| 聊过的章含真实事实;没聊的章只有氛围文案不胡编 | `test_v2_skipped_no_proper_nouns.py`:skipped 章文案做 NER/词表抽查,**不含任何未由 user/EXIF 提供的人名/地名/事件/日期**(§10.3 可测规则) |
| 最终册子进现有编辑器、就地编辑、**导出 PDF** | ① `test_v2_edit_patch.py`(patch 形态);② **Web e2e `test_v2_export_flow`**:finalize→EDITING→进编辑器渲染 `album_pages`→本地 `@react-pdf` render(mock)→presigned PUT 上传 R2→confirm→`status=COMPLETED`;断言**全程不回传原图、原图只在浏览器**(不变式 1/4) |
| base64 与原始 GPS 不落库、不进日志 | `test_v2_privacy_redact.py`:断言日志输出无 base64/坐标片段;**v1 无 GPS** → 断言 init 入参拒收 lat/lng、draft_json 内无任何坐标、`place` 全 null(比需求"只存粗地名"更强) |

### 9.2 单元 / 算法验收

- `test_skeleton_partition.py`:N=1..30 各 partition,断言每页张数 ∈ {1,2,3}、hero 每章 ≤1 solo、覆盖所有 used 照片不重复;**关键不变量(B5):每页 `fill_count ≤ capacity[size]`**;含 **all-fill fixtures**(3 fill / 6 fill / 全 30 fill / 无 hero),断言 3-fill 页被拆成 2+1、不空槽、不崩溃。
- `test_pick_template.py`:① **(useCase, 槽数)双维度匹配,chapter 1-up 绝不返回 mag-01/13/p01/mag-17(B6)**;② fill 图不进 hero 槽(Hall 可行性);③ 同 seed 可复现、attempt++ 变化;④ 3-up exclude 耗尽优雅降级不抛错;⑤ **partition 产出的任意页喂入 pickTemplate,can_place 后候选永不空集**;⑥ reroll 撤销回到原 templateId。
- **★ 共享 golden fixtures(修复评审 P2-5,防 TS/Python 骨架双实现漂移)**:确定性骨架有两份实现——Agent Python(init/edit)与 Web TS(改分组免费重排,§3.5)。在 `packages/contracts/fixtures/skeleton/*.json` 放一组 **(输入 photos+exif → 期望 pages[templateId,images,texts])** 金标准,**TS 与 Python 各自跑同一批断言逐字节一致**(seed 同源 → 输出确定)。必覆盖:1 图、3 图、**all-fill(3/6/30)**、TOC 触发、ending 选图、48 页边界、**单图 reuse=2**。这是两端不漂移的**唯一保证**,比"靠文档共享规则"硬。
- `test_grouping.py`:EXIF 时间切章(v1 无地点维度);**无 takenAt 走独立队列、不进 gap 比较(M3)**;groupHint 只段内细分不跨批合并;跨批确定性去重(3s + tag 0.8);无 EXIF 放弃跨批判重;**去重后空章被删、role 在删后重标(M3)**。
- `test_finalize_flatten.py`:**theme 缺失时 derive_default_theme(B7)**;树 → 扁平 pageIndex 0..N-1;cover→toc?(mag-02)→chapters→ending(mag-17) 顺序;TOC 阈值(≥4 章且≥8 页);**TOC texts 是扁平 bracket-path 键 `items[i].title`、值全是 string、无数组(P0-3)**;**30 张不超 48 页且不丢图(M2)**;**任一 photoId 全书 ≤2 次,且"只有 1 张图"时 cover 走 mag-20、该图恰 2 次(P0-4)**;**all-fill 时 cover/ending 走 hero 豁免、chapter 页不豁免(B8)**;**首页判定按 category=='cover'(P2-9)**;拍平 layout 过 `validate_v2`。
- `test_chapter_state_machine.py`:empty→asking→brief_ready→generated;askCount≥2 自动前进;skipped 路径。
- `test_credit_hold_settle.py`(Web 侧):init hold、finalize settle(置 EDITING 非 COMPLETED)、**`kind=init` 失败 release + FAILED**、**`kind=finalize` 失败保留 hold + 回 EDITING**、重进草稿不二次扣、**24h draft-expiry release(§12)**、PDF 确认才置 COMPLETED。
- `test_v2_privacy_redact.py`:见 §3.1(init 入参拒收 lat/lng / pool 无坐标且 place 全 null / 日志无坐标·base64 片段)。
- `test_v2_schemas.py`:**所有 v2 object `.strict()`/`extra='forbid'` 真的拒未知字段——尤其 init `exif` 收到 `lat/lng` 必须报错而非 strip(P0-2,D-GPS 隐私执行点)**;**`V2Callback` 是 union(progress/failed)+ `discriminatedUnion('jobKind')`(两个 completed),不是单 `discriminatedUnion('event')`,且 init-completed 必带 draftTree 且无 layout、finalize-completed 反之(P0-1)**;handler 断言 `payload.jobKind==job.kind`。
- `test_idempotency_concurrency.py`(Web 侧):见 §11——**抢锁 UPDATE(EDITING+draft_json非空+layout_json null→AGENT_RUNNING)0 行即 409 `ALBUM_NOT_EDITABLE`(P1-5)**;**并发两次 finalize 被 partial unique index 拒一个(P1-7)**;requestId 唯一;late callback 丢弃矩阵;**finalize 后再 finalize 被前置条件挡(不撞 album_pages 唯一索引)**。

### 9.3 mock / real 边界

沿用 `design.md §12`:`AGENT_PIPELINE_MODE=mock` 跑 CI(不烧 token),`real` 跑联调/生产;production 非 real 启动失败。v2 init/finalize 的 mock 分支产确定性假 draftTree / layout 供 e2e。

---

## 10. 施工顺序建议(供执行轨道排期)

1. **T0 契约 + 迁移**:`v2.ts`(§1/§2:AlbumDraft + 5 端点 + `V2Callback` + Usage/patch)+ Python 镜像 + migration(§8:draft_json/chapter_id/agent_jobs.kind)。**不动 layout.ts**(B1)。其它全部依赖它。
2. **Stage 1+3(init)**:`grouping.py`(§3,纯时间分组)+ `skeleton.py`(§4)+ `v2_album.py::init` + Web init 转发 + `/api/v2/internal/job-progress`(jobKind 分流)+ hold。先 mock 后 real。
3. **Stage 2/4(theme/chapter-chat)**:同步端点 + 状态机 + Web 持树 merge + album_messages(chapter_id)。
4. **Stage 5(finalize)**:ensure-theme + 补文 + 收尾 + 拍平 + settle(置 EDITING)+ kind=finalize 失败/收尾分流。
5. **Stage 6(edit)**:`/v2/album/edit` + pickTemplate Tool,**接管新旧作品全部编辑**(编辑器统一调它)。
6. **并发/过期/隐私/验收**:§11 幂等并发 + §12 draft-expiry sweep + redact 列表 + §9 全套测试 + 不变式 11/12 登记。
7. **v2 cutover(删 v1,D-V1Kill)**:v2 全流程跑通后,**同一 PR** 删除 `apps/agent/src/routes/{layout,chat_edit}.py` + 相关 service、`apps/web` 的 `/api/v1/*` 旧路由与 `/v1/chat-edit` 调用。前提:新建入口与编辑器已切到 v2(不能先删后断)。旧作品数据(`album_pages`/`layout_json`)不动。

> 每个轨道动手前对照 `architecture.md` 十二条不变式 + 本文 §7 契约边界自查。按项目流程:开发完成先派 review engineer 评审、修复测试全部问题,确认无误才提交。

---

## 11. 幂等与并发(修复评审 Q3)

异步双 job(init/finalize)+ 重复点击 + late callback,必须有明确规则,不靠默契:

| 风险 | 规则 |
|---|---|
| **requestId 复用** | `agent_jobs.request_id` 现有 UNIQUE 约束;每次 init/finalize 生成新 `requestId`。重复 callback 同 `requestId` 命中已终态 job → 直接 200,不重复写(沿用 `contract.md §9.2` 幂等)。 |
| **同 album 同 kind 互斥** | **不能只靠查询(有 TOCTOU 竞态,修复评审 P1-7)**。两道硬锁:① **抢锁式状态机**——提交 finalize 用**条件更新**作为锁:`UPDATE albums SET status='AGENT_RUNNING' WHERE id=? AND status='EDITING' AND draft_json IS NOT NULL AND layout_json IS NULL`,**影响行数=0 即冲突** → 409 `ALBUM_NOT_EDITABLE`;只有抢到的请求才建 job。② **DB 兜底**——`agent_jobs` 上 partial unique index `(album_id, kind) WHERE status IN ('QUEUED','RUNNING')`(§8),并发建第二个 job 直接被唯一约束拒。两道叠加,重复点击「完成」不会并发出两个 requestId。 |
| **finalize 前置条件(硬,修复评审 P1-5)** | 必须 **`status='EDITING' AND draft_json IS NOT NULL AND layout_json IS NULL`** 三条同时成立。`layout_json IS NULL` 是关键:finalize 成功会写 `layout_json`+`album_pages`,**若漏掉该条件,finalize 后再点 finalize 会撞 `album_pages` 唯一索引或产生无意义 job**。该三条即上面抢锁 UPDATE 的 WHERE。init 期间 album=`AGENT_RUNNING`,抢锁失败,自然拒 finalize。 |
| **late / 乱序 callback** | 处理矩阵:job 已 `COMPLETED`/`FAILED`(终态)→ 任何后到 callback(progress/completed/failed)一律 200 丢弃。`progress` 晚于 `completed` → 丢弃(终态优先)。zombie sweeper 已翻 FAILED 后 Agent 迟到的 `completed` → 丢弃(不复活已退积分的 album)。 |
| **finalize 重试** | 上次 finalize 失败 → album 回 `EDITING`,hold 维持;重试发**新 `requestId`** 的 finalize job;旧失败 job 留痕(status=FAILED, kind=finalize),不影响新 job。 |
| **callback 鉴权** | `/api/v2/internal/job-progress` 同 `AGENT_SHARED_SECRET` Bearer 校验(不变式 10)。 |

测试 `test_idempotency_concurrency.py` 覆盖以上每行。

---

## 12. 草稿过期 sweep(修复评审 M1)

需求 §10.5「草稿 24h 未完成 → 释放预留积分」。**现有 `recover-stuck` cron 扫的是 stale `agent_jobs`(RUNNING 超时),不是闲置草稿**——草稿是 `EDITING` 态、没有 RUNNING job,现有 sweeper 扫不到。故**新增一条独立 sweep**(并入每日 cron + 读时机会式,与现有 zombie 双保险同形):

```sql
-- 闲置草稿判定:init 成功(EDITING + draft_json 非空 + 尚未 finalize)且 hold 仍 HOLDING,
-- 距最后活动(albums.updated_at,每轮 chapter-chat/theme touch)超 24h
SELECT a.id, h.id AS hold_id
FROM albums a
JOIN credit_holds h ON h.album_id = a.id AND h.status = 'HOLDING'
WHERE a.status = 'EDITING'
  AND a.draft_json IS NOT NULL
  AND a.layout_json IS NULL                 -- 关键:还没 finalize(finalize 会写 layout_json)
  AND a.updated_at < now() - interval '24 hours';
```

```
draftExpirySweep():
  for (albumId, holdId) in 上面查询:
    事务(不变式 8):
      creditService.release(holdId)         # HOLDING → RELEASED;ledger GENERATION_RELEASE
      # album 保持 EDITING-草稿(draft_json 不删),用户仍可回来;但 hold 已退
      # 若用户回来再 finalize → finalize 路径重新 precheck + hold(架构 §5)
```

- **触发**:① 复用每日 `recover-stuck` cron,加这条查询(同一 cron 两类清理);② 读时机会式——`albumService.getDetail`/`listByUser` 命中 `EDITING + layout_json=null + updated_at>24h + HOLDING` 时当场 release(对齐 `design.md §7` 读时收尸)。
- **幂等**:`release` 对已 RELEASED 的 hold no-op;重复 sweep 安全。
- **与 24h 内重进的关系**:24h 内 hold 仍 HOLDING → 重进沿用、不二次扣(需求 §10.5);超 24h 被本 sweep 释放后重进 → finalize 时新 hold。两条路径在 `credit_holds.status` 上自洽。
- **`updated_at` 语义依赖**:chapter-chat / theme / 改分组每轮必须 touch `albums.updated_at`,否则闲置判定不准——这是 Web 持久化层的硬要求(§3 持树回写时一并 touch)。
- 测试见 §9.2 `test_credit_hold_settle.py`(24h draft-expiry 分支)。

### 12.1 finalize 接单的"补 hold"流程(修复评审 P1-6)

过期 sweep 释放 hold 后,`albums.credit_hold_id` 指向的 hold 已是 RELEASED。若 finalize 直接按它 settle,会去结算一个 released hold → **实际不扣费**。故 **finalize 接单(抢锁 UPDATE 成功后)在同一事务内补 hold**:

```
finalizeIntake(albumId, userId):
  事务(不变式 8,与抢锁 UPDATE 同事务):
    hold = activeHolding(albumId)                       # status='HOLDING' 的 hold
    if hold is None:                                    # 24h 已过期释放,或从未持有
      creditService.precheck(userId, N)                 # 余额不足 → CREDIT_INSUFFICIENT,回滚抢锁
      hold = creditService.hold(userId, albumId, N)     # 新建 HOLDING;ledger GENERATION_HOLD
      albums.credit_hold_id = hold.id                   # 重指向新 hold
    # 否则:24h 内重进,沿用原 HOLDING hold,不二次扣(需求 §10.5)
    建 finalize job(kind=finalize, requestId=新)
  # finalize completed 回调时:creditService.settle(albums.credit_hold_id) 必落在 HOLDING hold 上
```

- **关键**:settle 永远结算 `albums.credit_hold_id` 当前指向的 hold;补 hold 保证它在 finalize 成功时一定是 HOLDING 态。
- precheck 失败(余额不足)发生在抢锁 UPDATE 之后、建 job 之前,事务回滚把 album 状态退回 `EDITING`,前端跳 `/pricing`(沿用架构 §6.5 决策 2)。
- 测试 `test_credit_hold_settle.py` 增:过期释放 → 重进 finalize → 断言新建 HOLDING hold、settle 真实扣费、`credit_hold_id` 已重指向。
