# Stage 2 选版式(Gemini 视觉排版)— 板块详设

- 日期:2026-06-26
- 状态:详设 v1(板块架构师产出)
- 高度:到**接口 / 调用契约 / 资源 / 兜底 / 批处理**层。**不写 prompt 细节**;`gemini_layout` 模块定义归「共享板块」,本文只定 Stage2 怎么用它 + `/v3/select-layout` 端点。
- 上游蓝图:`docs/superpowers/specs/2026-06-25-agent-system-blueprint.md`(§1/§2 Stage2、§4 边界、§5 共享接口、§6-6 异步形态)
- 接地代码:
  - `apps/agent/src/agents/image_understanding/handler.py`(Stage1 describe 衔接,目前内嵌的分页/选模板逻辑要被剥到 Stage2)
  - `apps/agent/src/engine/skeleton_v3.py`(确定性兜底:`legal_candidates` / `pick_template_v3` / `assign_images_v3` / `validate_grouping` / `partition_photos_v3` / `wrap_with_cover_ending`)
  - `apps/agent/src/agents/template_select/handler.py`(`plan_pages` / `fallback_pages` 逐页 chunk + 合法候选 helper,Stage2 复用)
  - `apps/agent/src/flows/analyze.py`(异步 job + callback 编排范式,Stage2 select-layout 照抄)
  - `apps/web/src/components/album/templates/*`(React 模板 + `registry.ts` + `constants.ts` PAGE 794×1123;预览图烘焙的渲染源)
  - `packages/contracts/templates/*.json`(模板 JSON 真相源;`category` / `images` / `items` 结构描述来源)

---

## 0. 范围与边界(先划清,避免越界)

Stage2 = **「选版式 + 图→槽」**。它消费 Stage1 的 `tree`(★无 pages),产出 `pages[]` 写回 `draft_json.pages`。

四个边界点(详见 §8):

1. **消费 Stage1 `tree`**:Stage1 现在产 `V3LayoutTree`(章节含 photos + sceneDescription,★无 pages)。`describe` 内嵌的分页/选模板代码(`_assemble_chapter_pages` / `_legal_capacity_table` / `_flatten_pages`)**搬出 Stage1**,Stage2 接管。Stage1 callback 去掉 `pages`(蓝图 §2 ★契约变更)。
2. **复用 `gemini_layout`(共享板块)**:Stage2 是主调用方,但模块签名归共享板块。本文只引用 `gemini_layout(...)` 签名(蓝图 §5),不重定义。
3. **复用 `skeleton_v3`(共享板块)**:钳/兜底全走既有引擎函数,Stage2 不复制护栏逻辑。
4. **Stage3 case4 也复用同一 `gemini_layout`**:故 Stage2 **绝不**把「整本 wrap 封面封尾 / folio·date」「批处理调度」「select-layout 端点」等 Stage2 专属逻辑塞进 `gemini_layout`。`gemini_layout` 只做「units → pages 意图(无色)」。

---

## 1. 新端点 `/v3/select-layout`

### 1.1 形态:异步 + callback(与 `/v3/analyze` 同范式)

蓝图 §4 标 Stage2 为「异步(按章/簇批量)」。理由:200px 真图 + 模板预览图多模态调用 + 多批 Gemini,挂钟可能数十秒,**不能同步阻塞 HTTP**。复用 `flows/analyze.py` 的 `_Job` + `_emit_progress` + `callback.post` 范式:

- **HTTP 路由**:`routes.py` 收 `SelectLayoutRequest` → 校验 → 返回 `202 Accepted` → 后台任务跑 pipeline。
- **callback**:进度 `progress` 节拍 + 终态 `completed`(带 `pages[]`)/ `failed`。Agent 无状态(§3),不写库不推 stage;Web 收 callback 合并 `draft_json.pages`。
- **进度词表**:复用 `V3JobStage` 思路,新增 `jobKind="select-layout"`,stage 词:`"layout"`(Gemini 调用)→ `"legalize"`(确定性钳)→ `"wrap"`(封面封尾 + folio/date)。具体 enum 值跟随蓝图 §6-7「进度词表 V3JobStage 详设定」,与状态机板块对齐(本文标依赖,不擅自定 enum)。

> 同步 vs 独立 job(蓝图 §6-6 开放点):**采用独立 job**(与 analyze 一致),不做同步批。原因:select-layout 必然多批 Gemini,同步会撞 HTTP 超时;独立 job 让进度可观测、失败可重试、与 analyze 编排同构,Web 编排路由图只需加一条边。

### 1.2 请求契约 `SelectLayoutRequest`(NEW)

```
SelectLayoutRequest {
  requestId: str
  callbackUrl: HttpUrl
  language: "en" | "zh"
  chapters: [                       # Stage1 tree 的「排版切片」(Web 从 draft_json.tree 摘)
    {
      chapterId: str
      photos: [ { photoId, ref200px, orientation } ]   # 200px 真图(base64),orientation 代码已填
      structureHint?: str           # 结构描述(章节级,见 §3.2);prompt 细节不在本文
    }
  ]
  # candidates 不在请求里 —— 由 Agent 内部从模板库 + 预览图资源装配(§2.3),
  # 避免把全模板预览 base64 塞进 Web→Agent body(图量预算 §4)。
}
```

要点:
- **图来源 = 浏览器 200px**(蓝图 §4)。Web 从 `draft_json.tree.chapters[].photos[]` 取 photoId/orientation,base64@200px 由浏览器随请求带(800px 只在 Stage1 用过,Stage2 重发 200px)。
- **base64 不落盘**(§3 隐私):Web 直接转发,Agent 读完即弃引用,绝不 log。
- **candidates 由 Agent 装配**,不进请求体(见 §2.3 + §4)。

### 1.3 响应契约(callback `completed`)

```
SelectLayoutCompleted {
  event: "completed"
  jobKind: "select-layout"
  requestId: str
  pages: Page[]            # 全 Page[](含封面封尾)+ folio/date;形状 = 现有 schemas.Page,★渲染契约冻结
  usage: V3Usage           # durationMs / geminiCallCount / models
}
```

`pages[]` 形状**不变**(`pageIndex / templateId / images:{slotId→photoId} / texts`),Web 合并进 `draft_json.pages`。★Stage2 不出色(色留 tree,Stage4 才落),`texts` 仅 folio/date 等通用装饰。

---

## 2. Gemini 调用(经 `gemini_layout` 共享模块)

### 2.1 调用契约(引用共享板块签名,不重定义)

Stage2 把每批装配成 `gemini_layout` 的 `units` 入参(蓝图 §5):

```
gemini_layout({
  units: [ { chapterId,
             photos: [{photoId, ref200px, orientation}],
             candidates: [{templateId, previewImage, V3TemplateCandidate}] } ],
  结构描述,
  mode: "select",          # Stage2 固定 "select";Stage3 case4 传 "case4-swap"
  allowAddPages: bool      # Stage2 = true(Gemini 决定一章切几页);见 §2.5
})
  -> { pages: [{chapterId, templateId, slots:{slotId→photoId}}] }   # 只意图,★无色
```

Stage2 对 `gemini_layout` 的用法约定:
- **mode="select"**:全新排版(对照 Stage3 case4 的 swap)。
- **`candidates` 带 `previewImage`**:由 Stage2 从预览图资源装配(§2.3),`V3TemplateCandidate` 来自 `skeleton_v3.legal_candidates`(§2.4)。
- Gemini 输出是**意图**(templateId + 图→槽),无色;直接接 `skeleton_v3` 钳(§5)。

### 2.2 Gemini provider / 端点 / 关思考

`gemini_layout` 走 **OpenAI 兼容端点**(Gemini 的 OpenAI-compat `/chat/completions`),复用现有 `ai_client.chat_completion` + slot 抽象(`vision_provider.py` 的 `VisionSlot` 模式)。本文只锁 Stage2 对该 slot 的**调用参数约定**(具体 slot 构造归共享板块 / settings):

- **关思考**:Gemini 侧用 `reasoning_effort`(OpenAI-compat)或 `thinking_budget`(原生)关掉/最小化推理 —— 排版是结构化抽取,推理只增延迟与截断风险(对照 `ark_disable_thinking` / `composing_disable_thinking` 的既有判断)。具体字段名按 Gemini 端点能力,挂在 settings,默认关。
- **`max_tokens`**:按「每批页数 × 每页 slot 映射」估算 headroom(参考 describe 的 `describe_max_output_tokens` 经验值),宽于纯文本抽取但远小于 describe(无 description/scenes,只出 templateId + slots)。
- **`response_format`**:Gemini OpenAI-compat 支持 json,优先 `json_object`;不支持则靠 prompt「STRICT JSON only」+ `parse_json_loose`(同 ark 分支退路)。
- **简易 id**:喂图给 Gemini 用 `to_simple` / `from_simple`(共享板块,蓝图 §5)把长 hash photoId 映射成 1,2,3…,回来再反映射 —— 与 describe 的 `_remap_describe_photo_ids` 同理(防小模型抄岔 id)。映射归共享板块,Stage2 只调用。

### 2.3 候选装配:预览图从资源加载(不进请求体)

每个 unit 的 `candidates[].previewImage` 由 **Agent 内部从预览图资源加载**(§3 烘焙产出),不由 Web 传。流程:
1. Stage2 对每章算合法候选 templateId 集(§2.4)。
2. 对每个候选 templateId,从预览图资源目录加载对应 PNG(或目录图,§3.4),组成 `previewImage`(base64 / data-uri)。
3. 连同 `V3TemplateCandidate`(templateId/category/imageSlotCount)装进 `candidates`。

好处:模板预览图是**定长资产**(只随模板库变,与相册无关),不必每请求从 Web 搬过网络;Agent 进程内缓存一次加载(同 `skeleton_v3.POOLS` 的一次性构建模式)。

### 2.4 候选容量过滤(★≤章节图数,多章取章内最大)

蓝图 §2:「候选容量 ≤ 章节图数,多章取章内最大」。落地:

- **逐章**:候选 = `skeleton_v3.legal_candidates("interior", N)`,N = 该章图数(`legal_candidates` 已实现「精确容量优先 + 更大容量兜底」,且只给能装下 N 张的模板)。
- **一批含多章**(§4 打包):候选集取**批内各章 N 的最大值**对应的合法集的**并集**,确保每章都能在候选里找到合法模板;但每章在 prompt/装配里仍按自己的 N 过滤(避免给小章塞超大模板)—— 即「多章取章内最大」用于装配候选**池**,逐章应用各自上限。
- category 固定 `interior`(封面封尾不进 Gemini,由确定性 wrap 补,§6)。

### 2.5 同章不切 + Gemini 可加页

- **同章绝不切到下一批**(蓝图 §1/§2 ★):打包单元的最小粒度 = **一章**(§4)。
- `allowAddPages=true`:Gemini 在**一章内**决定切几页(一章可出多页),但章边界由 Stage2 守(批边界=章边界)。Gemini 的章内分页意图随后由 `skeleton_v3.validate_grouping` 校验(每页 1..容量、不丢不重保序),不合法则该章退确定性基线(§5)。

---

## 3. 模板预览图烘焙(前置,路 A)

**路 A = 一次性渲染灰块低清 PNG 脚本**(boss 选定方向)。模板预览图是 Gemini「看版式骨架」的输入,**不需要真照片**,只需版式结构 + 灰块占位。

### 3.1 烘焙方案

- **渲染源**:复用现有 React 模板组件(`apps/web/src/components/album/templates/mag-*`),无头渲染(Playwright / puppeteer / `@react-pdf` 截帧)成 PNG。页面尺寸 = `PAGE` 794×1123(`constants.ts`),低清缩放(如 ×0.25 → ~200px 宽)省体积。
- **灰块占位**:渲染时给每个 image slot 喂占位灰块(`WebImage` 已有 `placeholder` 行为 —— 不传 `src` 时显示占位;烘焙时用统一灰色块替代),文字槽喂占位短串或留空。产物 = **纯版式骨架低清图**(哪里放图、哪里放字、几栏几格)。
- **脚本位置**:新增烘焙脚本(顶层 `scripts/` 或 `apps/web/scripts/`)。**新增顶层目录需架构师在 architecture.md 登记**(CLAUDE.md 铁律)—— 本文标为待登记项,优先放 `apps/web/scripts/`(已存在 `seed.ts`,无需新顶层目录)。
- **触发**:手动 / CI 在**模板变更时重跑**(§3.5)。非运行时路径。

### 3.2 结构描述(随预览图一起喂,文字辅助)

每模板配一段**结构描述**(几张图槽、朝向偏好、几栏文字、grid/单图…),从模板 JSON(`packages/contracts/templates/*.json` 的 `images`/`items`/`texts`)+ registry label 派生。它是 `gemini_layout` 入参的「结构描述」字段的素材;**具体文案/prompt 不在本文**(硬要求)。结构描述与预览图一起降低 Gemini 误判版式的概率。

### 3.3 资源存放 + Agent 加载

- **存放**:烘焙产物 PNG + 结构描述 JSON 存为**版本化资产**(随仓库,如 `apps/agent/src/engine/template_previews/<templateId>.png` + `.json`,或 `packages/contracts/template-previews/`)。最终目录由架构师在 architecture.md 登记;倾向放 Agent 可直接读的路径(避免跨包运行时依赖)。
- **Agent 加载**:Stage2 启动时一次性加载进进程缓存(同 `templates.TEMPLATES` / `skeleton_v3.POOLS` 模式),装配 `candidates` 时按 templateId 取。

### 3.4 目录图(省 Gemini 图量预算)

蓝图:「按容量拼『目录图』以省 Gemini 图量预算」。落地:把**同容量桶的多个候选预览图拼成一张『目录图』**(grid 拼版,每格标 templateId),Gemini 一次只看少量目录图而非几十张独立预览图 —— 把候选预览的图片数从 O(候选数) 降到 O(容量桶数)。

- 目录图也在烘焙脚本里**预生成**(按容量桶拼),Stage2 按批内涉及的容量桶加载对应目录图。
- 与 §4 图量预算联动:Gemini 单批总图量 ≈ 章内真照片(200px)+ 少量目录图。

### 3.5 模板变更重跑

模板库变(加/改/删 mag-*)→ 重跑烘焙脚本 → 预览图 + 目录图 + 结构描述刷新。加**一致性自检**(同 `registry.ts` 的 missing 检查):每个 `TEMPLATE_IDS`(interior 类)必须有对应预览图,缺则烘焙脚本报错。CI 可加门禁防漏烘焙。

---

## 4. 打包 / 批处理(图量预算,按章/簇批,同章不切)

复用 Stage1 describe 的装箱思路(`image_understanding._plan_describe_routes` 的 first-fit-decreasing 整簇装箱),规则与 Stage1 一致:

- **单元 = 一章**(同章不切,§2.5)。一章的所有 200px 图必须在同一批。
- **图量预算**:每批总图量(章内真照片 200px + 目录图)≤ 预算上限(settings,如 `select_layout_max_images_per_batch`)。超大单章(图数 > 预算)单独成批(它无法再拆,容量上限本身是用户分寸)。
- **装箱**:章按图数降序,贪心塞进当前最轻的批(同 describe `_plan_describe_routes`),批数受 `select_layout_max_concurrency` 封顶。
- **并发**:每批一次 `gemini_layout` 调用,`asyncio.gather` 并发(同 `_describe_on_slot`)。整批受统一 deadline 包裹(同 describe 的 `asyncio.wait_for`),慢批触发整步降级(§5.3)。
- **合并**:各批产出按 chapterId 归位,跨批 pages 按章节顺序展平、pageIndex 重排(复用 `_flatten_pages` 思路)。章节全局顺序由 tree 的章序决定(不依赖批序)。

---

## 5. 确定性兜底(复用 skeleton_v3,局部只重算失败章/页)

### 5.1 逐章/逐页钳(Gemini 成功时)

Gemini 出意图后,逐章跑既有护栏(**与 Stage1 现 `_assemble_chapter_pages` 同款逻辑搬过来**):

1. **章内分页合法**:`skeleton_v3.validate_grouping(pages_ids, chapter_ids, category="interior")`(每页 1..容量、不丢不重保序)。
2. **逐页模板合法**:页 templateId ∉ `skeleton_v3.legal_candidates("interior", N)` → 置 None,`skeleton_v3.build_page_v3` → `pick_template_v3` 确定性补选。
3. **图→槽**:`skeleton_v3.assign_images_v3(templateId, photoIds)` 按声明顺序塞槽(无 quality/hero/orientation 匹配,比例不符由渲染 center-cover 吸收)。

> 这套逻辑是 `skeleton_v3` + `template_select.plan_pages/fallback_pages` 已有的;Stage2 **只是调用方**,把 Stage1 内嵌的同款代码搬到 Stage2 handler。

### 5.2 局部只重算失败章/页

- **逐页**:某页 templateId 非法 → 只该页走 `pick_template_v3` 补选,**不动同章其它页**。
- **逐章**:某章分页整体不合法(`validate_grouping` False)→ **只该章**退确定性基线(`partition_photos_v3` + 逐页 `pick_template_v3`),**不动其它章**。
- **逐批**:某批 Gemini 调用失败(传输错误)→ 见 §5.3,只该批降级,健康批保留(局部降级,非全步)。

### 5.3 Gemini 失败整步降级 vs 局部

两档:
- **局部降级(优先)**:单批/单章/单页失败 → 只该粒度退确定性,其余保留(§5.2)。
- **整步降级(兜底)**:Gemini provider 整体不可用(全批传输失败 / slot 未配 / 超 deadline)→ **整步走纯确定性**:对全部章节用 `skeleton_v3.build_skeleton_v3`(逐章 `partition_photos_v3` + `pick_template_v3` + `assign_images_v3`)产出合法正文页。**绝不让 select-layout 因 Gemini 挂而失败** —— 始终产出合法 `pages[]`(优雅降级,与 analyze 的 describe-failover 哲学一致,但 Stage2 的纯代码兜底更强:有确定性引擎托底,不必硬失败)。

> 仅当**确定性引擎本身**抛错(如某章图数超任何模板容量,理论不该发生)才发 `failed` callback(`AGENT_OUTPUT_VALIDATION`)。

---

## 6. wrap + generic(2c,纯代码)

Gemini + 钳产出的是 **interior 正文页**。Stage2 末步复用既有确定性函数:

- `skeleton_v3.wrap_with_cover_ending(interior_pages, chapters)`:前后补默认封面/封底页(hero = 首/尾照片),pageIndex 重排。
- `generic_copy.fill_generic_copy(pages, chapters)`:叠加 folio / date / dateNum 等通用装饰进 `texts`(用户文案槽留空,Stage3 写;色留空,Stage4 落)。
- 产出 `Page[]` → callback。**这一步与 analyze `_build_preview` 完全同款**,直接复用(封面封尾不进 Gemini,§2.4)。

---

## 7. 与 describe 瘦身的衔接(Stage1 → Stage2)

- **Stage1 改动**(消费侧契约):`image_understanding.describe_content` **去掉分页/选模板**——删 `_assemble_chapter_pages` 的 pages 装配、`_legal_capacity_table` 注入、`_flatten_pages`、`V3AnalyzeResult.pages`;describe 只产 `tree`(章节 + description + sceneDescription + 代码填属性,★无 pages)。Stage1 callback `V3AnalyzeCompleted` 去掉 `pages` 字段(蓝图 §2 ★契约变更,需契约/状态机板块同步改 `schemas.py` + `packages/contracts/src/v3.ts`)。
- **Stage2 接管**:`/v3/select-layout` 收 tree 切片 → Gemini 排版 → 钳 → wrap → `pages[]`。原 Stage1 内嵌的分页/选模板代码(已经是「Gemini-less 的容量表 + 护栏」)在 Stage2 升级为「Gemini 选版式 + 同款护栏兜底」。
- **Web 编排**:analyze 完成(收 tree)→ Web 触发 select-layout(带 200px)→ 收 pages 合并 `draft_json.pages`。Web 编排路由图加一条边(契约板块登记)。

---

## 8. 边界点汇总(对接其它板块)

| # | 边界 | 谁拥有 | Stage2 怎么用 |
|---|---|---|---|
| B1 | Stage1 `tree`(★无 pages) | Stage1 / image_understanding | 消费 tree 切片;Stage1 要剥掉分页代码 + callback 去 pages(契约变更) |
| B2 | `gemini_layout(units,...)` 签名 | 共享板块 | Stage2 主调用方(mode="select"),只引用签名;Stage3 case4 复用(mode="case4-swap")—— Stage2 专属逻辑(批处理/wrap/端点)**不塞进** gemini_layout |
| B3 | `skeleton_v3`(legal_candidates/pick_template_v3/assign_images_v3/validate_grouping/partition_photos_v3/wrap_with_cover_ending) | 共享板块(引擎) | Stage2 钳 + 局部/整步兜底全走它,不复制护栏 |
| B4 | 进度词表 V3JobStage + `/v3/select-layout` 契约 + callback | 契约/状态机板块 | Stage2 定端点语义,enum 值与 schema 跟随契约板块登记(蓝图 §6-7) |

---

## 9. 实现清单(供后续拆 PR)

1. **烘焙脚本**(路 A):无头渲染 React 模板 + 灰块 → 预览 PNG + 目录图 + 结构描述 JSON;一致性自检;模板变更重跑(资源目录 + 顶层目录归属待 architecture.md 登记)。
2. **Stage1 瘦身**:`describe_content` 去 pages;`V3AnalyzeCompleted` 去 pages(契约板块协同)。
3. **`/v3/select-layout` 端点 + 异步 job**:`routes.py` 接 202;`flows/select_layout.py` 编排(照抄 analyze 的 _Job/progress/callback)。
4. **批处理**:章为单元的图量预算装箱(复用 describe `_plan_describe_routes` 思路)。
5. **Gemini 调用**:经共享 `gemini_layout`(关思考 / max_tokens / json / 简易 id / 候选容量过滤 + 预览图装配)。
6. **钳 + 兜底**:复用 `skeleton_v3`(局部重算失败章/页 + 整步降级)。
7. **wrap + generic**:复用 `wrap_with_cover_ending` + `fill_generic_copy`。
8. **契约**:`SelectLayoutRequest` / `SelectLayoutCompleted` + jobKind/stage 进 `schemas.py` + `packages/contracts/src/v3.ts`(契约板块)。
</content>
</invoke>
