# Composing 重设计 · 施工技术方案

> 状态:**技术方案(可施工),待架构师 + 用户过闸**。本文是 [`composing-redesign.md`](./composing-redesign.md) §9 点名的「技术方案窗口」交付物 —— 它把那份文档的**决策/契约/影响面地图**推进成**能直接照着开工的施工方案**。
>
> 前置阅读:`composing-redesign.md`(决策基线,D-A~D-E 已锁,本文**直接采用不重议**)→ 本文。
>
> **铁律(沿用 redesign §1)**:Agent 对外 I/O 一字不动(`AlbumLayoutPlan` 契约不变);模板单向流向 Agent;预览图≠原图,最终渲染用浏览器本地原图;LLM 只输出 photoId 绝不 URL;页数公式废除但 `pages` 仍受 1..16 schema 硬边界约束。
>
> **工作纪律**:先把方案 + 架构图全部写进本文,过架构师闸门(§11),再写任何代码。
>
> 行号核对于 2026-06-03,对齐核心仓库 `memoir-agent-rebuild`(非 showcase)。

---

## 0. 这次到底改什么(一句话)

把压在 **orientation 硬约束 + 页数死公式 + 文案 maxChars 硬卡**上的组合优化负担**从确定性收尾层卸下来**,让弱模型只解它解得动的部分;模板从**三处手工副本**收敛成**一份 JSON 单一真相源**,支撑"疯狂加封面/尾页模板"。页数改成"实际排出",但仍保留 1..16 输出边界;对外契约和"必出片"保证**不动**。

---

## 1. 现状基线(as-is,带行号)

### 1.1 三处模板真相源(必须收敛)

| 位置 | 形态 | 喂给谁 | 现状问题 |
|---|---|---|---|
| `packages/contracts/src/templates.ts`(406 行) | TS + zod,`TemplateDef`/`TemplateSlotConstraint` | 名义单一真相源;Web 直接 import `TEMPLATE_IDS` | `orientation`/`quality` **必填**(`z.array` 无 `.optional()`) |
| `apps/agent/src/templates.py`(283 行) | Python `TypedDict` **手工镜像** | composing/chat-edit prompt + 确定性校验 | 文件头自承"manual diff is sufficient",**漂移风险常在** |
| `apps/web/src/components/album/templates/registry.ts` | `templateId → {WebTemplate, PdfTemplate}` 硬编码 import | React 预览 + `@react-pdf` 导出 | 喂的是**组件**不是**约束**;新增模板要手改 import 表 |

> registry.ts 已有一致性自检:`TEMPLATE_IDS.filter(id => !(id in TEMPLATE_REGISTRY))` 抛错。新模板进 JSON 后,这个自检会逼着补组件——是好事,保留。

### 1.2 确定性收尾层(`apps/agent/src/services/layout_rules.py`,835 行)

| 函数 | 行 | 作用 | 本次命运 |
|---|---|---|---|
| `_expected_page_count` | :31-33 | `min(16, max(3, ceil(n/2.5)))` 死公式 | **废公式**(Q3:页数=实际),但 1..16 schema 边界保留 |
| `_photo_fits` | :80-84 | `orientation in C AND quality in C` | **拆**成 `_quality_ok`(硬,hero 保护)/ `_orientation_prefers`(软) |
| `coerce_image_slots` | :250-470 | orientation 错配兜底主力(5 阶段) | 退化:orientation 不再驱动清除/重排,只剩 hero 保护 + 覆盖 + 重复 |
| `violation` | :473-560 | 9 条硬规则 | Rule 1 改 1..16 sanity、删 orientation(:527-532)、删 Rule 9(:540-548)、保留 hero 子集 |
| `repair_instruction` | :563-641 | 违规→repair 指令 | 删 orientation 段(:573-579)、删 maxChars 段(:634-638)、改页数段(:608-613) |
| `build_text_first_layout` | :756-834 | 1-2 图确定性兜底 | 页数语义随 Q3 调;orientation 软化后退化路径减少 |
| `clamp_page_texts`/`clamp_text` | :36-77 | 文案"只缩"安全网 | **保留**(Q5:作纯安全网,不报错=非硬限制) |

`violation()` 9 条规则现状逐条(行号是判违规处):

1. 页数 == 公式(:479-484,**严格相等**,多了也违规)
2. 首页 cover 类(:486-491)
6. pageIndex 连续(:493-496)
8. slot key ⊂ 模板(:504-513,含"缺槽即违规")
5. orientation(:527-532)+ quality(:533-538)
9. 文案 maxChars(:540-548)
3. 每图≥1 次(:550-553)
4. 单图≤2 次 / 同页不重复(:516-523 + :555-558)

### 1.3 Prompt 里的硬编码点(`services/planning.py` / `services/vision.py`)

| 位置 | 行 | 硬编码内容 |
|---|---|---|
| `_composing_system_prompt` | :211 / :218 | 页数公式 `ceil({n}/2.5)` 写进 prompt + Rule 1 |
| 同上 | :223-224 | Rule 5「orientation AND quality 必须满足」 |
| 同上 | :228 | Rule 9「文案 ≤ maxChars」 |
| 同上 | :231-238 | FEW-PHOTO guidance |
| `vision._build_system_prompt` | :41-63 | 9 字段输出契约 + hero_cap(无 groups) |
| `templates.summarize_for_prompt` | templates.py:264-282 | registry dump,每槽打 `orient=..,quality=..` |

### 1.4 对外契约(`contract.md §4` / `schemas.py`)— **本次不动**

`AlbumLayoutPlan = { magazine, photos: PhotoAnalysis[], pages: Page[] }`;`Page = { pageIndex, templateId, images:{slot:photoId}, texts:{slot:str} }`。D-E:`images` 值永远是 photoId。Agent 现有 `schemas.py` 对 `pages` 有 `min_length=1,max_length=16`,本次保留。**复核确认不变,仅在 §3.3 钉死。**

---

## 2. 目标态架构

```
┌─ WEB ───────────────────────────────────────────────────────────┐
│ 收集照片 → base64(预览图,≤800KB) + photoId + w/h               │
│ POST /v1/layout { photos:[{photoId,base64,w,h}], prompt, lang }  │
└───────────────────────────┬──────────────────────────────────────┘
        (只给图未给编码 → 入口确定性补 photoId,绝不交 LLM · D-E)
                            ▼
┌─ AGENT(无状态)────────────────────────────────────────────────┐
│ ① vision (火山)   PhotoAnalysis[] + groups[](内部,不进对外契约)│
│ ② writing(DeepSeek) Magazine{title,subtitle,style}  style 必落枚举 │
│ ③ composing(DeepSeek) 按 style 选模板 / photoId 塞 slot / 填文案   │
│      orientation = prompt 软引导(不硬卡 · D-B)                    │
│      尾页从某 group 挑(暂定 · D-D);输出仅 photoId(D-E)          │
│ ④ 确定性收尾层(代码硬做 · D-E)                                    │
│      硬:hero保护 · 首页cover · pageIndex连续 · 每图≥1 · 同页不重复 · slot key│
│      软:orientation(渲染端 cover 兜底) · 文案长度(clamp 只缩)      │
│      页数 = 实际排出页数(非公式),但必须在 1..16 内                 │
└───────────────────────────┬──────────────────────────────────────┘
                            │ callback: AlbumLayoutPlan(契约不变)
                            ▼
┌─ WEB 渲染(React 预览 + @react-pdf 导出,两端一致)───────────────┐
│ 按 templateId 读共享模板库 JSON;photoId → IndexedDB 取「原图」      │
│ object-fit: cover 作用于原图(web-utils:43 / pdf-utils:72 已就位)   │
│ [TODO·web] center-cover 裁切(不做人脸避让,§7)                      │
└───────────────────────────────────────────────────────────────────┘
        ▲读                                            ▲读
        └────────── 共享模板库 packages/contracts/templates/<id>.json ─┘
                    (单一真相源 · loader 两端读 · §4)
```

模块职责切分(谁负责"对"、谁负责"美"):
- **LLM(②③)**:创意 —— 选模板、塞图、写文案、orientation 软偏好。**允许出错**。
- **确定性收尾层(④)**:必对 —— 把 LLM 的产物收敛到一定过校验、一定出片、绝不空槽、绝不丢"唯一一张图"。
- **渲染层(web)**:必美 —— cover 缩放 + center-crop 吸收 orientation 错配;本期不承诺人脸避让。

---

## 3. 数据形态完整规格

### 3.1 模板 JSON schema 定稿（钉死 README 草案）

`packages/contracts/templates/<id>.json`,一模板一文件,文件名 = `id`。loader 用下面这套 schema **强校验**(两端共用同一份 zod/pydantic 定义)。

```jsonc
{
  "id": "mag-21",                 // 必填,唯一,== 文件名
  "category": "cover",            // 必填,enum: cover|spread|single|grid|closing
  "styles": ["warm-film"],        // 可选,该模板适配的 style(D-C)。省略 = 适配全部 style
  "imageSlots": {
    "image": {
      "orientation": ["landscape"], // 可选 · 软提示(D-B),仅喂 prompt,确定性侧不硬卡
      "quality": ["hero", "detail"] // 可选 · 见下「quality 的双重语义」
    }
  },
  "textSlots": {
    "heading": {
      "type": "heading",            // 必填,enum: heading|caption|label|meta|paragraph|quote|array
      "recommendedMaxChars": 12     // 可选 · 推荐长度(用户逐模块标),仅 prompt 提示 + clamp 只缩
    }
  }
}
```

**字段语义钉死(取代 README 里的 `[待定]`):**

| 字段 | 必填 | 确定性侧语义 | 模型侧语义 |
|---|---|---|---|
| `id` / `category` | 是 | category 参与"首页必 cover"硬校验 + 尾页 group 挑选 | — |
| `imageSlots[k].orientation` | 否 | **不硬校验**(D-B);省略=任意 | 写了 → 喂 prompt 作软偏好 |
| `imageSlots[k].quality` | 否 | **仅 hero 保护**(见下);省略=任意 | 写了 → 喂 prompt 作软偏好 |
| `textSlots[k].type` | 是 | 决定 `_real_texts` 兜底填什么 | 喂 prompt |
| `textSlots[k].recommendedMaxChars` | 否 | **不判违规**(Q5);`clamp_text` 只缩不报错 | 喂 prompt 作长度建议 |

**`quality` 的双重语义(Q1 已锁,这是本次最容易写错的点)**:
- 字段保留三值 `hero|detail|fill`,但确定性侧**只保留一条硬规则**——「**hero 保护**」。
- **定义**:称一个 image slot 为 **hero 槽** ⟺ 它的 `quality` 列表**包含 `hero`**(满版/叙事担当位)。
- **硬规则**:`quality='fill'` 的照片**不得进入任何 hero 槽**。其余 quality 匹配(detail↔detail、hero 进 fill 槽等)**全部降为模型软偏好**,确定性侧不判违规。
- 理由:fill 是远景/缩略级,塞进满版位 = "放炮打蚊子",视觉硬伤、cover 缩放也救不回(它本就小)。反向(hero 进小槽)只是浪费,不是硬伤,交给模型软偏好。
- 旧 `README` 把 `quality` 整体标 `[待定 Q1]` —— **错**(已锁)。本计划已把决策/锁定状态移到本文 §3.1 + `composing-redesign.md §5`;Task A 创建 / 更新 package README 时,README 只留纯录入契约(字段怎么填),不再承载 Q1/Q5 这类决策状态。

> **`recommendedMaxChars` vs 旧 `maxChars/minChars`**:现有 21 模板(templates.py / templates.ts)用的是 `minChars`/`maxChars`,且 `maxChars` 进 Rule 9 硬校验。迁移时:`maxChars` → `recommendedMaxChars`(软),`minChars` **丢弃**(从来只在 prompt 提示、未硬校验,且文案软化后无意义)。

### 3.2 `groups` 内部结构(§9.3.2 点名要我定)

vision 阶段额外产出 photo 分组,供 composing 做"同组照片排到相邻页 / 尾页从某 group 挑"(D-D)。**纯内部结构,绝不进对外 `AlbumLayoutPlan`**(铁律:对外契约不动)。

```python
# schemas.py 新增(internal,不在 callback envelope 里)
class PhotoGroup(_Strict):
    groupId: str                 # "g1" 等,vision 顺序生成
    label: str                   # 模型给的主题短语,如 "kyoto-spring"(仅喂 composing prompt)
    photoIds: list[str]          # 该组照片,⊂ photos[].photoId
    role: Literal["opening", "body", "closing"] | None = None  # D-D:closing 组供尾页挑

class VisionResult(_Strict):     # vision 阶段内部返回(取代现在直接返 list[PhotoAnalysis])
    photos: list[PhotoAnalysis]
    groups: list[PhotoGroup]
```

**流动**:`vision.analyze()` 返回 `VisionResult` → pipeline 把 `groups` 透传给 `compose_pages(groups=...)` → composing 把 groups **序列化进 system prompt**(作分组/尾页线索)。`writing` 不需要 groups。**`groups` 不参与确定性校验**(模型线索而已),所以 vision 即使分组烂也不影响出片。

**可靠性 = 确定性节点保证(用户已锁,不依赖模型自觉)**:
> 用户定调:模型产出不可信任,Agent 设计里有**专门的确定性代码节点**清洗所有数据;模型真崩时用**死数据(死流程)兜底**,保证输出可靠。groups 走的就是这条线 —— 它是"模型给的线索",但**经过确定性节点后才进 composing,且永远有死数据可退**。

- **确定性节点(收尾层的前置)**:vision 返回的 raw groups 先过一道纯代码清洗:`groupId` 去重、`photoIds ⊂ photos`(越界 id 剔除)、空组丢弃、`role` 非法值归 `None`。
- **死数据兜底**:清洗后若 `groups` 为空 / 不可用 → **不报错、不阻塞**,直接用确定性规则现造一套"死分组"(如按 vision 的拍摄顺序/quality 均分,closing 组取末尾若干张),保证 composing 总能拿到一个**可用且确定**的分组。
- 推论:**groups 永远可靠**(要么模型给的+清洗,要么死数据),composing 和尾页 D-D 不需要写任何"分组不可靠"分支。**这条把原 §12-Q4 关掉了。**

### 3.3 对外契约复核(确认**不变**)

`contract.md §4` 的 `AlbumLayoutPlan` / `Page` / `PhotoAnalysis` / `Magazine` —— 字段、形状、`images:{slot:photoId}` 全部不动。`PhotoAnalysis.orientation` **仍然产出**(模型软匹配 + 渲染端 cover 都要用),只是失去"确定性硬校验地位"。**callback envelope 三 variant 不动。**

**页数边界确认不变**:`pages` 的公式目标废除,但不是无限自由。Agent Pydantic schema 现有 `pages: Field(min_length=1,max_length=16)`,本次保留为硬边界;TS/Web 契约不新增字段。为了不让 LLM 输出 17+ 页时在 `AlbumLayoutPlan(...)` 构造处直接 `ValidationError`、绕过 deterministic coerce,必须在 `_coerce_pages()` 后、构造 `AlbumLayoutPlan` 前增加纯代码 normalize(见 §5.2.1)。

---

## 4. 单一真相源 + loader 设计

### 4.0 loader 是什么、为什么非要它(背景)

模板现在是**硬编码字面量**(templates.ts / templates.py 各一份)。改成 `<id>.json` 后,必须有一段代码把 JSON 读回成"现在的代码已经在用的那几个导出",否则下游当场坏。**loader 就是这段代码。** 它**不是新功能,是为"模板搬家到 JSON"补的接缝**——搬家前后,下游 import 形状不变。

具体下游(已核实,2026-06-03):
- **Web · `adapt-layout.ts:81-87`**:渲染时调 `getTemplate(id).textSlots`,靠 `constraint.type === 'array'` 把 `cells`/`items` 这类槽重建成真数组,否则组件 `.map` 崩。→ **TS 侧必须能拿到完整模板定义(至少 `textSlots[].type`),不只是 id 列表。**
- **Web · `registry.ts` + `preview/template/[id]/page.tsx`**:用 `TEMPLATE_IDS`(registry 还有覆盖自检)。
- **Agent · composing/chat-edit**:`summarize_for_prompt()` + `violation()`/`coerce` 全套约束。

所以 TS loader 必须产出**完整 `TEMPLATES` + `getTemplate` + `TEMPLATE_IDS`**(不能退化成只给 id 列表)。

### 4.1 目标拓扑

```
packages/contracts/templates/<id>.json   ← 唯一真相源(用户批量维护)
        │
        ├── scripts/gen-templates → packages/contracts/src/templates.generated.ts(提交进仓)
        │         └── templates.ts re-export getTemplate / TEMPLATE_IDS / TEMPLATES（形状不变）
        │                   └── apps/web/.../registry.ts、adapt-layout.ts（零改动,照常 import）
        └── apps/agent/src/templates.py：Python 启动期直接读同一批 JSON → 取代手工镜像（消灭漂移）
```

### 4.2 两端 loader（机制已定:TS 走生成文件,Python 直接读）

- **TS 端**——**走"生成文件"路线(本文锁定,取代原 §12-Q1 待定)**:`scripts/gen-templates.ts` 读 `templates/*.json` → 用 schema 校验 → 输出 `packages/contracts/src/templates.generated.ts`(纯字面量,**提交进仓**)。`templates.ts` 只剩 schema 定义 + 从 generated 文件 re-export `getTemplate`/`TEMPLATE_IDS`/`TEMPLATES`。
  - 为什么不走 `import.meta.glob` / 运行时 `fs`:跨 package 边界让 Next.js 打包任意 JSON 容易出幺蛾子;生成文件**确定性强、diff 里看得见、可审、零运行时 IO**。
  - **同步硬要求**:新增 `pnpm templates:generate` 与 `pnpm templates:check`。`generate` 写 `templates.generated.ts`;`check` 重新生成到临时文件并 diff 已提交文件。根 `pnpm test` 或 `pnpm typecheck` 必须包含 `templates:check`,否则 JSON 改了但 generated 没更新会让 Web/Agent 再次漂移。
- **Python 端**(`templates.py` 改造):启动时 `pathlib` 读 `packages/contracts/templates/*.json`,pydantic 镜像 schema 校验,构建 `TEMPLATES`/`TEMPLATE_IDS`/`COVER_TEMPLATE_IDS`/`summarize_for_prompt()`,**对外函数签名不变**(`get`/`is_known`/`summarize_for_prompt`),调用方零改动。Python 直接读 JSON(无生成步骤)——它本来就在容器里跑,运行时读文件没有打包问题。
- **部署路径锁定**:Agent 镜像必须能读到同一批 JSON。采用 **repo root 作为 Fly build context + `-f apps/agent/Dockerfile`** 的路线,并改 Dockerfile 为 root-context 路径:`COPY apps/agent/pyproject.toml ./`、`COPY apps/agent/src ./src`、`COPY packages/contracts/templates ./packages/contracts/templates`。部署命令/文档同步为从仓库根执行 `fly deploy -c apps/agent/fly.toml --dockerfile apps/agent/Dockerfile .`。如果将来坚持以 `apps/agent` 为 build context,必须先把模板 vendoring 到 agent 包内;本次不走这条。
- **路径自检**:Python loader 启动时按顺序找 `YUJEE_TEMPLATE_DIR`(可选)→ `/app/packages/contracts/templates`(容器)→ repo-root `packages/contracts/templates`(本地 dev)。找不到或 schema 失败直接 fail fast,并在 Agent 测试里加路径 smoke test。

### 4.3 schema 单一定义

`imageSlots[k].orientation/quality` 转 `optional`(TS:`.optional()`;Python:`total=False` 或 `| None`)。新增 `styles?: string[]`、`textSlots[k].recommendedMaxChars?`。**两端 schema 必须从同一份语义派生**(TS zod 为准,Python 手写镜像但加单测断言两端枚举一致——见 §10)。

---

## 5. 确定性收尾层改写(写到能直接落代码)

### 5.1 `_photo_fits` 拆分(:80-84)

```python
def _quality_ok(photo, constraint) -> bool:
    """唯一保留的硬约束:hero 保护。fill 照片不得进 hero 槽。"""
    q = constraint.get("quality")
    if q and "hero" in q and photo.quality == "fill":
        return False
    return True

def _orientation_prefers(photo, constraint) -> bool:
    """软偏好,仅 coerce 择优 / prompt 用,NEVER 用于判违规。"""
    o = constraint.get("orientation")
    return (not o) or (photo.orientation in o)

def _photo_placeable(photo, constraint) -> bool:
    """coerce/fallback 找'能放'的槽时用 = 仅硬约束。"""
    return _quality_ok(photo, constraint)
```

> 全文搜索 `_photo_fits` 的调用点(coerce 的 Phase 1/2/3、`_template_assignment`、`_rehome`、`_cover_for_photo`、`_page_slot_for_photo`、`_filled_content_page_for_photo`):凡是"判这张图**能不能**放这个槽"的,换 `_photo_placeable`(只剩 hero 保护);凡是"择优排序",叠加 `_orientation_prefers` 作 sort key(软优先,放不下也不拒)。

### 5.2 `violation()` 新形态(:473-560)

| 旧规则 | 新规则 | 改法 |
|---|---|---|
| Rule 1 页数==公式(:479-484) | **schema/sanity 边界**:`1 <= len(pages) <= 16` 且 page0 是 cover | 删公式;`_expected_page_count` 不再被 violation 调;超 16 在 pre-schema normalize 先处理 |
| Rule 2 首页 cover(:486-491) | 不变 | — |
| Rule 6 pageIndex 连续(:493-496) | 不变 | — |
| Rule 8 slot key + 缺槽(:504-513) | 不变("缺槽即违规"保留 → 支撑 #42 无空槽) | — |
| Rule 5 orientation(:527-532) | **删** | 整段删 |
| Rule 5 quality(:533-538) | **改 hero 保护**:仅当 `fill 进 hero 槽`才违规 | 调 `_quality_ok` |
| Rule 9 文案 maxChars(:540-548) | **删** | 整段删;长度交 `clamp_page_texts` |
| Rule 3 每图≥1(:550-553) | 不变 | — |
| Rule 4 ≤2 次/同页不重复 | 不变 | — |

> **chat-edit 复用同一个 `violation()`**(`services/chat_edit.py` patch 应用后回归)——§10 必须含 chat-edit 回归,否则改了 violation 会悄悄改变 chat 行为。

### 5.2.1 页数 normalize(必须在 `AlbumLayoutPlan(...)` 前)

`planning.py:352-358` 现在流程是 `_coerce_pages(parsed)` → `clamp_page_texts` → `AlbumLayoutPlan(...)`。因为 `schemas.py:88` 保留 `max_length=16`,如果 LLM 输出 17+ 页,会在 Pydantic 构造处直接 `ValidationError`;若 repair 仍失败,`layout is None` 后会 `ComposingError`,完全绕过 `coerce_image_slots`。所以页数自由化必须配一个**构造前**归一化节点:

```python
MAX_PAGES = 16

def _normalize_page_count(pages: list[Page], photos: list[PhotoAnalysis]) -> list[Page]:
    if not pages:
        raise ComposingError("composing response missing pages[]")
    if len(pages) > MAX_PAGES:
        pages = _trim_to_max_pages(pages, photos, max_pages=MAX_PAGES)
    return [page.model_copy(update={"pageIndex": idx}) for idx, page in enumerate(pages)]
```

`_trim_to_max_pages` 的确定性策略:
- **优先保留 cover**:若第 0 页不是 cover,仍先保留原第 0 页,让 Rule 2/repair 负责;不要在这里猜模板替换。
- **先丢低信息页**:text-only 页优先丢;其次丢所有图片都已在其它保留页出现过的重复页;最后才从尾部裁。
- **尽量保留唯一图片覆盖**:裁剪时避免丢掉某个 photoId 的唯一出现页。若 16 页内仍无法覆盖所有照片,后续 `violation` 会报 Rule 3,`coerce_image_slots` 再尝试把未用照片塞进现有 image slot;仍残留才失败。
- **永远 reindex**:normalize 后 pageIndex 从 0 连续,避免 LLM 输出 20 页但裁剪后留下 0,1,4,9。

验收:加一个 mock case 让 composing 返回 17+ 页,确认 `_normalize_page_count` 在 `AlbumLayoutPlan(...)` 前把页数收进 16,不会走 `layout is None` 的 parse-fail 死路。

### 5.3 `repair_instruction()` 同步(:563-641)

- 删 orientation 段(:573-579)、删 maxChars 段(:634-638)。
- 改页数段(:608-613):删"输出 EXACTLY 公式页数",改为"页数自由但必须 1..16 页;首页必须 cover、pageIndex 从 0 连续、每个图片槽必须填满"。
- quality 段(:580-585)改成只讲 hero 保护:"fill 级照片不要放进满版主图槽"。

### 5.4 `coerce_image_slots` / `build_text_first_layout` 退化

- coerce 5 阶段逻辑**结构保留**,但"判能不能放"全走 `_photo_placeable`(只剩 hero 保护)→ 大多数 orientation 错配**不再触发清除/重排**,coerce 从"主力"退成"几乎不触发的安全网"(覆盖 Rule3 / 重复 Rule4 / 无空槽 #42 / hero 保护)。**不删**(仍是必出片的最后防线)。
- `_expected_page_count`(:31):violation 不再用;coerce/fallback 里凡"按公式补/裁页"改为"按实际排出页数 + 1..16 边界"。`build_text_first_layout` 的补页目标(:779,:823)从公式改为:cover + 每图一页 + **至多补到一个 sanity 下限(如 3 页)**,不再追公式上限;任何补页都不得超过 16。
- **`mag-09 imageMain` quality `['hero','detail']`** 等边界:orientation 软化后,square hero 进 mag-09 不再因 orientation 被拒;`_relax_to_placeable`(:102)的 square-hero→detail 仍保留(hero 保护让 fill 不进,但 square+hero 进 detail 槽是允许的,只是 prompt 软偏好)。

### 5.5 已知 registry gap(顺带评估)

`build_text_first_layout` 注释(:770-775):**square-only 的 ≤2 图相册**无单图模板可放,会留残余违规。orientation 软化**不解决**这个(它是 slot 数量问题,不是 orientation)。**建议**:用户"疯狂加模板"时,加 1 个 square 单图模板即可关闭此 gap → 列入 §12 给用户的待办,不阻塞本次。

---

## 6. Prompt 改动

### 6.1 vision(`vision.py:41-63`)
- 输出契约**加 `groups`**:让模型在返回 photo 数组之外,额外给 `{groups:[{label, photoIds, role}]}`(§3.2)。需把输出从"纯数组"改成"`{photos:[...], groups:[...]}`对象",解析侧 `vision.analyze` 同步改(数组→对象,长度校验改 `photos` 字段)。
- orientation 字段**保留产出**(渲染/软匹配要)。

### 6.2 writing(`planning.py:45-63`)
- 基本不动。`style` 五枚举 + 选择 rule of thumb 保留。D-C:确认无"匹配不到 style"分支(现状 `_coerce_magazine` 已是非法 style → 落 `warm-film`,符合"必匹配",保留)。

### 6.3 composing(`planning.py:210-241`)— 改动最大
- **删页数公式**(:211,:218):Rule 1 prompt 改成"页数自由,按你的叙事节奏定,但必须输出 1..16 页;首页必须 cover 类;每个图片槽都要填照片(不留空)"。
- **orientation 降软**(:223-224 Rule 5):改成"**尽量**把横图放横槽、竖图放竖槽(系统会自动缩放兜底,所以这是偏好不是硬性);**但** fill 级小图**不要**放进满版主图槽"。
- **删 Rule 9**(:228):不再讲 maxChars;改成"文案尽量贴近每槽的推荐长度"。
- **喂 groups**(§3.2):user payload 加 `groups`;system 加"同组照片尽量排到相邻页;尾页可从 role=closing 的组挑图(D-D)"。
- `summarize_for_prompt`(templates.py:264-282):orientation/quality 改成"软提示"措辞;quality 标注哪些是 hero 槽。
- **FEW-PHOTO guidance**(:231-238)保留(text-only 补页仍有效)。

---

## 7. Web 渲染调整(本次执行内,我负责改 · 用户已定)

> 用户已定:本期采用 **center-cover 裁切**。以图片中心为原点,按能填满 slot 边界的尺寸裁切;不做人脸检测,不新增 focal point 字段,不改 `images:{slot:photoId}` 契约。

**现状核实(2026-06-03)**:`web-utils.tsx:43` / `pdf-utils.tsx:72` 两端都是 `objectFit:'cover'`。两端未显式写 `objectPosition`,浏览器语义等价 center;本期把它显式化并审计 `@react-pdf` 是否同语义。注意:center-cover 只能保证不留白、不变形、中心裁切一致;它**不能**保证人脸避让,人脸偏上/偏边仍可能被裁。

待改(我执行):
1. **显式 center-cover**:`web-utils`(`WebImage`)+ `pdf-utils`(`PdfImage`)两端都写成 `objectFit:'cover'` + `objectPosition:'50% 50%'`(或 React PDF 等价写法),**两端同语义**(否则预览与导出裁得不一样)。
2. **resize / cover 正确性审计(用户点名:不对的地方也要改)**:全量过一遍两端 cover 缩放——确认 `object-fit:cover` 在所有 image slot(含 grid `cells[*]`、bracket-path 槽)行为一致、不变形、不留白;`@react-pdf` 的 `objectFit` 对各 slot 尺寸是否真生效(它的支持有坑)。发现不对当场修。
3. **比例容差本期不设硬规则**:不因图片/slot 比例差触发换槽或拒绝。任何比例差都由 center-cover 吸收;后续如果要做人脸/主体避让,另起浏览器侧焦点识别或用户手动调焦点方案。
4. 渲染用「原图」(铁律),裁切作用于原图,预览图只是排版近似。

> **强依赖**:Agent orientation 一旦降软,显式 center-cover + 两端一致审计**必须同窗口上线**(§8 的 E 与 D 同步),否则横竖错配时会出现预览/PDF 不一致、留白或变形风险。它是本期可靠兜底,但不是人脸避让方案。

---

## 8. 执行顺序 + 任务拆分 + 依赖图

```
A. 模板真相源 + loader(地基)
   A1 定稿 schema(§3.1)→ 改 templates.ts zod(orientation/quality optional + styles + recommendedMaxChars)
   A2 写 TS loader / 生成步骤(§4.2)+ templates:generate/templates:check
   A3 写 Python loader(§4.2)取代手工镜像
   A4 Fly/Docker root build context + COPY templates + loader 路径 smoke test
   A5 21 模板迁成 <id>.json(§9 迁移)
        │
        ▼
B. 确定性收尾层(依赖 A 的新 schema)
   B1 _photo_fits 拆分(§5.1)
   B2 pre-schema 页数 normalize(§5.2.1)
   B3 violation 改写(§5.2)+ repair_instruction 同步(§5.3)
   B4 coerce / build_text_first_layout 退化 + 废 _expected_page_count(§5.4)
   B5 chat-edit 回归(复用同一 violation)
        │
        ├────────────┐
        ▼            ▼
C. groups(vision)  D. prompt 改动(依赖 B 的新规则语义)
   C1 schemas 加     D1 composing prompt(§6.3)
      PhotoGroup/     D2 vision prompt 加 groups(§6.1)— 依赖 C1
      VisionResult   D3 summarize_for_prompt 改软措辞
   C2 vision.analyze
      返回 groups
        │
        ▼
E. Web 渲染调整(§7)— 与 D 同窗口上线,硬依赖
   E1 web-utils 显式 center-cover
   E2 pdf-utils 同步
   E3 resize/cover 正确性审计 + 修(用户点名)
   E4 确认不做比例硬容差 / 不做人脸避让

G. 新增模板入库(用户正在做,独立项)— 见下
```

**关键依赖**:A 是地基(B/C/D 都依赖新 schema);**E 必须与 D 同时上线**(orientation 降软后,视觉兜底不到位会立刻翻车)。页数 normalize 必须在 `AlbumLayoutPlan(...)` 前。chat-edit 回归不可省。

### 8.1 任务 G:新增图片模板入库(独立项,用户主导 + 人工合并)

> 用户正在增加图片模板(含可关闭 §5.5 square gap 的单图模板)。这是一条**独立于 A~E 的并行线**,但产物要并进同一个模板库,故单列。

- **G1 录入**:用户按新 JSON schema(§3.1)在 `packages/contracts/templates/` 下新增 `<id>.json`。
- **G2 人工合并 / 调整(用户点名:需要人工)**:新模板的 slot 命名、约束、对应的 Web/PDF 组件(`registry.ts` 手写 import + `<id>/index.tsx`、`<id>/pdf.tsx`)**由人工合并、逐个调试视觉**,不自动化。registry.ts 的覆盖自检会逼着补齐组件。
- **G3 让 Agent 知道(用户点名)**:新模板进库后,Python loader 自动纳入(无需改 Agent 代码),`summarize_for_prompt` 自动把它喂进 composing prompt;若新增了 square 单图模板 → **更新 §5.5 gap 状态为"已关闭"** + `build_text_first_layout` 注释(:770-775)同步去掉 gap 说明。
- **依赖关系**:G 依赖 A(loader + JSON schema 就位)才能正确入库;但 G 的模板**内容**与 A~E 的代码改造解耦,可并行推进、最后汇合。

---

## 9. 迁移策略:21 模板 → JSON

**推荐:一次性切(big bang),不灰度。** 理由:模板是纯静态约束数据,JSON 由现有 templates.py/.ts **机械导出**即可(写个一次性脚本 dump 现有 `TEMPLATES`),正确性靠 §10 的"两端 loader 产物 == 旧硬编码"快照测试保证,无运行时风险,灰度反而徒增两套并存的复杂度。

步骤:
1. 脚本把现有 21 个 `TEMPLATES`(以 templates.py 为准,逐个核对 templates.ts 一致)dump 成 `<id>.json`,**字段名转新 schema**(`maxChars→recommendedMaxChars`,丢 `minChars`,加空 `styles`)。
2. loader 读 JSON,跑快照测试:loader 产物的 `TEMPLATE_IDS` / 每模板 slot 结构 == 迁移前(模 orientation/quality 已转 optional、文案字段改名)。
3. 删 templates.py 手工 `TEMPLATES` 字面量 + templates.ts 硬编码字面量,改成 loader 输出。
4. registry.ts 不动(自检守覆盖)。

---

## 10. 测试 + 验收

| 测试 | 覆盖 | 文件 |
|---|---|---|
| loader 快照 | 两端 loader 产物 == 迁移前 21 模板(模已知字段变更) | 新 `test_template_loader.py` + TS 单测 |
| 两端枚举一致 | Python 镜像 schema 的 enum/字段 == TS zod | 现有 `templates.test.ts` 扩 |
| generated 同步检查 | JSON 改了但 `templates.generated.ts` 未更新时 `pnpm templates:check` 必失败;根 `pnpm test` 或 `pnpm typecheck` 包含它 | package scripts + TS 单测 |
| Agent 模板路径 | 容器/root build context 能读到 `packages/contracts/templates`;本地 dev fallback 也能读;找不到 fail fast | `test_template_loader.py` + Docker/Fly smoke |
| 页数 normalize | LLM mock 输出 17+ 页时,构造 `AlbumLayoutPlan` 前收进 16 页并 reindex;不会走 `layout is None` parse-fail 死路 | `test_pipeline_mock.py` |
| violation 新规则 | orientation 错配**不再违规**;fill→hero 槽**仍违规**;1..16 任意页数通过;>16 由 normalize 先处理/仍出现则违规;缺槽仍违规 | `test_layout_rules.py` |
| **chat-edit 回归** | patch 应用后跑新 violation,行为符合预期(§5.2) | `test_chat_edit_patch.py` |
| coerce 退化 | orientation 乱配的 layout 经 coerce **不丢图、不空槽**且过新 violation | `test_coerce_no_empty_slots.py` |
| 1 图 fixture | ≤2 图走 build_text_first_layout,过新 violation(架构 §6.5-6 验收硬要求) | `test_composing_fallback.py` |
| 页数实际化边界 | 7-8 图模型排 N 页,N≠旧公式但在 1..16 内也通过 | `test_pipeline_mock.py` |
| center-cover 裁切 | 竖图进横槽按中心裁切;预览/PDF 不留白、不变形、裁切一致(不承诺不切头) | 手动 / 截图 |
| e2e | mock 全绿;real 真火山 1/8/16 图各一遍 | `test_e2e.sh` |

**验收红线**(沿用 redesign 工作纪律):① 1 图 fixture 必须跑通,不许只改下限就宣布完成;② chat-edit 回归必须含;③ 17+ 页 mock 必须证明构造前 normalize;④ generated 同步检查必须进根测试/类型检查;⑤ Agent Docker/Fly 路径必须能读模板;⑥ web center-cover 目检过;⑦ 真实 prompt 在本仓库 Agent 内改,非 showcase 桩。

---

## 11. 架构师闸门 + 文档同步(CLAUDE.md 硬要求)

本次动到 **模板 schema / 确定性校验语义 / 新增 `packages/contracts/templates/` 子结构** → 触发 CLAUDE.md「必须先问架构师」。本文即闸门材料。Worker 0 已完成架构闸门的文档登记,实现 / 代码项仍待后续任务:

- [x] `architecture.md`:已在 §6.6 增补二期决策记录(cover 缩放 D-A、orientation 软化 D-B、页数实际化、文案软化、模板 JSON 单一真相源 `templates/`),并在 §4 目录登记 `packages/contracts/templates/`。
- [x] `architecture.md §3 十条不变式`:已复核——本次不破任何一条(契约不动、photoId 不变、必出片保留);第 9 条"写库前 zod 校验"仍成立,无需改不变式。
- [x] `contract.md`:已补文档说明,确认对外契约未变;orientation 失去硬校验地位但仍产出;页数公式废除但 1..16 边界保留;callback envelope 不变。
- [x] `design.md §4.2 / §4.3 / §5.1`:已改写 TemplateRegistry 来源、orientation/quality 约束语义、页数公式废除但保留 1..16、文案长度软化、center-cover 语义。
- [x] `composing-redesign.md §5/§8`:已标记 Q1/Q4/Q5 等 review-resolved 状态,同步清单已勾掉;未重开 D-A~D-E。
- [x] `docs/STATUS.md`:已把 #42 二期方向更新为 orientation 软化、fill→hero 保护、1..16 页边界、center-cover 无人脸避让、模板 JSON 单一真相源。
- [ ] `packages/contracts/templates/README.md`:Worker 0 不处理 package 级模板 README;该目录已从本 doc-gate worktree 移除,后续 Task A 随 loader / 模板 JSON 实施再建。

> **当前闸门状态**:架构文档登记已完成;仍禁止在本阶段写业务代码。后续实现任务按 §8 拆分执行。

---

## 12. 待确认项

**已在本轮评审中拍定(原 Q1/Q2/Q3/Q4 关闭):**

| 原 ID | 结论 |
|---|---|
| ~~Q1~~ TS loader 机制 | **关闭 → 锁"生成文件"路线**(§4.2):`gen-templates` 编 `templates.generated.ts` 提交进仓,Python 直接读 JSON。loader 用途见 §4.0。 |
| ~~Q2~~ cover 裁切策略 + 比例容差 | **关闭 → center-cover**(§7):以中心为原点、按填满 slot 的尺寸裁切;不做人脸避让、不加 focal point 字段、不设比例硬容差。 |
| ~~Q3~~ square 模板 gap | **关闭 → 列为独立任务 G**(§8.1):用户正在加模板,**人工合并/调试**;补了 square 单图模板就更新 §5.5 + `build_text_first_layout` 注释让 Agent 知道。 |
| ~~Q4~~ groups 可靠性 | **关闭 → 确定性节点 + 死数据兜底保证**(§3.2):不依赖模型自觉,groups 永远可用,composing/尾页不写"不可靠"分支。 |

**仍开:**无。

> redesign §9.4 的 Q1(hero 保护理解)已在本文 §3.1 钉死(fill 不进 hero 槽);其 Q4(焦点裁切)已在本文 Q2 关闭为 center-cover。

---

## 13. 一页纸总结(给评审)

- **改什么**:卸掉 orientation 硬约束 + 页数死公式 + 文案 maxChars 硬卡;模板三处副本 → 一份 JSON 单一真相源。
- **不改什么**:对外 `AlbumLayoutPlan` 契约、photoId-only、必出片、无空槽(#42)、hero 保护、隐私铁律。
- **风险点**:① 页数公式废除仍必须守 1..16,所以 pre-schema normalize 不可省;② orientation 降软**必须**配 web center-cover 同窗口上线(但不承诺人脸避让);③ chat-edit 复用 violation,改了必回归;④ 模板迁移靠快照 + generated check 守正确性;⑤ Agent Docker/Fly 必须能读到模板 JSON。
- **地基**:模板 loader(A)先行,B/C/D 依赖它;E 与 D 同步。
- **闸门**:本文过架构师 → 登记 `architecture.md` → 再开工(§11)。
