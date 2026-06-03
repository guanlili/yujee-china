# Composing 重设计 · 对齐契约(草稿)

> 状态:**探讨中,未开工**。本窗口只锁约束与方案,不写代码。
>
> 前置阅读:`docs/agent/design.md`(现状基线)→ `docs/agent/contract.md`(对外协议)。
>
> 这份文档记录"动手前的预期对齐"。每条决策标 `[已锁]` / `[待定]`。开工前必须把 `[待定]` 清空。
>
> **工作纪律(用户明确要求)**:不许瞎开工。**先把方案 + 系统架构图(§7)全部写进文档,再写任何代码。**
>
> **位置**:本文档位于**核心主力仓库 `memoir-agent-rebuild`**(`yujee-showcase` 只是它的删减 demo)。下文所有代码行号已**对齐到本仓库**(核对于 2026-06-03)。

---

## 0. 背景与病灶

现状 composing(`design.md §4`)把大量复杂度压在 **`orientation` 硬约束**上:弱模型要在一次调用里同时解"页数 + 模板选择 + orientation×quality 匹配 + 文案"的组合优化,7-8 张图时 orientation 经常算错,靠 `coerce_image_slots` / `build_text_first_layout` 兜底(`layout_rules.py`)。组合越硬,弱模型越崩。

用户两条新需求直接拆掉这条主梁:
1. 图片与模板尺寸不一致时,**用缩放兜底**(不再"放不进就拒绝")。
2. 封面/尾页模板要**大量增加**("疯狂加"),所以模板录入成本必须低,不能每个槽都手工调约束。

---

## 1. 铁律(不可破)

- **Agent 对外 I/O 一字不动**:`AlbumLayoutPlan` 契约(`contract.md §4`)不变。`PhotoAnalysis.orientation` 仍然产出(模型软匹配要用),只是它在**确定性校验里的硬约束地位**被取消。
- 模板数据单向从模板库流向 Agent,Agent 不自由生成 templateId。
- **预览图 ≠ 原图(图片双表示,核心)`[已锁]`**:
  - Agent / pipeline 全程只看**预览图(降采样编码,≤800KB,`contract.md §2.1`)**——用于 vision 识别与编辑期预览。
  - **最终渲染(出片 / 导出)在浏览器上用「原图」**。原图**只在浏览器**(架构不变式 1 / `§6.5-2`),始终不离开浏览器、不进 Agent。
  - 二者靠 **photoId** 串联:Agent 输出 `{slot: photoId}`(只认编码,绝不 URL · D-E),浏览器拿 photoId 去本地(IndexedDB)取原图渲染。
  - 推论:**`object-fit: cover` 的裁切(D-A)作用在「原图」上,发生在浏览器**;预览图只是排版近似,清晰度/裁切以原图为准 → §3 web 待办据此。

---

## 2. 已锁决策

### D-A 缩放语义 = `object-fit: cover` `[已锁]`
图缩放到**铺满槽位**、保持比例**不变形**、超出部分**裁掉**。否决 `contain`(留白)与 `fill`(拉伸)。
- 本期锁定 **center-cover**:以图片中心裁切,不新增 focal point / face detection 字段,不承诺人脸避让。

### D-B orientation = 模型侧软约束,确定性不再硬校验 `[已锁]`
(用户原话:"Orientation 一致:留给模型约束")
- composing **prompt** 里保留 orientation 引导,让模型**尽量**把横图放横槽、竖图放竖槽。
- 确定性 `violation()`(`layout_rules.py:527`,内含 orientation 检查)**删除 orientation 硬校验**:orientation 不匹配**不再判违规、不再触发 repair/coerce**。
- 模型万一错配,视觉上由 D-A 的 cover 缩放兜底,不影响出片。
- `coerce_image_slots` 的 orientation 感知逻辑随之退化(只剩 quality/覆盖/重复的安全网)。

### 保留不变的约束(用户已确认 OK)
| # | 约束 | 归属 | 状态 |
|---|---|---|---|
| 顺序 | `pageIndex` 0..N-1 连续 | 确定性硬校验 | ✅ 不变 |
| 每图至少用一次 | 每个 photoId ≥1 次 | 确定性硬校验 | ✅ 不变 |
| 首页 cover | page 0 必须 cover 类 | 确定性硬校验 | ✅ 不变 |
| 同页不重复 / 单图 ≤2 次 | | 确定性硬校验 | ✅ 不变(未讨论,默认保留) |
| 文案长度 | 每个模板标**推荐**长度 | 模板定义(用户逐模块标注)+ `clamp_page_texts` 兜底 | ✅ 用户会逐模块标 |

### D-C style 必匹配,无"匹配不到"分支 `[已锁]`
(用户:"'匹配不到风格'的情况不会存在")
- writing 阶段产出的 `style` 一定落在枚举内;composing 选模板时**总能**找到适配该 style 的模板(靠模板 `styles` 标注)。
- **不实现**"无 style 兜底"分支。模板适配 style 的内部调试由用户后续负责;本次先把框架定死。

### D-D 尾页(Close the year)从 group 挑,不设硬规则 `[已锁]`
(用户:"暂定从某个 Group 里面挑……文字记录即可")
- **不新增**"末页必须 closing 类"的确定性硬校验。
- 尾页模板从 vision 阶段产出的某个 photo group 里挑选,**暂定**,仅文字记录,后续可调。

### D-E 输入 / 输出 / 收尾规范 `[已锁]`
- **输入**:Web 请求体带每张照片的**图片 + 图片编码(photoId)**(`contract.md §2.1`:photoId + base64 + width + height)。若某来源**只给图、不给编码**,在入口用**确定性代码**补齐 `photoId ↔ 图片`映射,**绝不交给 LLM**。
- **输出**:LLM 最终只输出**图片编码(photoId)**,**严禁输出图片地址 / URL**(易错)。`Page.images` 始终是 `{slot: photoId}`;`photoId → 真实图像`的映射在收尾环节由确定性代码完成。
- **收尾环节**:用户用代码**硬做一套确定性收尾**(分配 / 比例匹配 / 校验 / 编码回填),保证输出确定。对应现有 `coerce_image_slots` / `clamp_page_texts` / `violation` 这层,本次定位为"**确定性收尾层**"——LLM 负责创意,收尾层负责"必对"。

---

## 3. 跨模块需求:WEB 侧 cover 视觉模块(本窗口新增记录)

**D-A 的实际像素活不在 Agent。** Agent 只产 `{slot: photoId}`,不碰图像。`object-fit: cover` 落在 web 的两条渲染路径,必须语义一致:
1. **编辑器预览**(React):`apps/web/src/components/album/templates/web-utils.tsx`
2. **导出**(`@react-pdf`):`apps/web/src/components/album/templates/pdf-utils.tsx`
（模板组件经 `web-registry.ts` / `pdf-registry.ts` 按 templateId 取;每模板有 `web.tsx` / `pdf.tsx`）

> **✅ 现状(核对核心仓库 `memoir-agent-rebuild`,2026-06-03)**:两条路径**都已用 `object-fit: cover`** —— `web-utils.tsx:43`、`pdf-utils.tsx:72`。即 **D-A 在渲染层基本已满足、两端一致**(不是 showcase 里以为的"withheld/待从零做")。
>
> **⚠️ 剩余待办(web 轨道,务必随本需求交付 —— 用户明确点名)**
> 1. **显式 center-cover**:现状默认 center-crop(无 `objectPosition`),需在 `web-utils` 与 `pdf-utils` 两端显式写出等价语义,保证预览 / PDF 一致。
> 2. **比例差不设硬容差**:不因图片/slot 比例差换槽或拒绝,统一由 center-cover 吸收。
> 3. 渲染用「原图」(§1 铁律),裁切作用于原图;预览图只是排版近似。本期不做人脸避让。
>
> 此项归 **web**,但属于本需求不可分割的一部分。

---

## 4. 代码影响面(Agent 侧,仅记录,未开工)

| 位置 | 现状 | 改成 |
|---|---|---|
| `layout_rules.py:527-538`(`violation` 内 orientation/quality 检查) | orientation+quality 硬校验 → 违规 | **删 orientation 硬校验**(保留 hero 保护,见 Q1) |
| `layout_rules.py:80 _photo_fits` | orientation AND quality | 拆:`_quality_ok`(硬,hero 保护用)/ `_prefers`(择优用,如仍需) |
| `coerce_image_slots` (`:250-471`) | orientation 错配兜底主力 | 退成"几乎不触发"的 hero/覆盖/重复安全网 |
| `_cover_for_photo` (`:647-659`) | 无 orientation 匹配 cover → 退化 mag-20 纯文字 | 退化大幅减少(任何带图 cover 都能放任何图) |
| `templates.ts:4-8 TemplateSlotConstraint` | orientation/quality 必填 | 两者转 **optional**(不标=任意接受)→ 支撑"疯狂加模板" |
| `_expected_page_count` (`:31`) + `violation()` Rule 1 (`:479-482`) | 页数 == `max(3,ceil(n/2.5))` 死公式,严格相等 | **废公式**:页数 = 实际排出页数;Rule 1 改成 sanity 边界(≥1、首页 cover、pageIndex 连续)。**chat-edit 复用同一 `violation`,一并回归** |
| `violation()` Rule 9 文案长度 (`:540-547`) | maxChars 超了判违规 | **删除硬校验**;推荐长度仅喂 prompt;`clamp_page_texts` 至多留作"只缩"安全网 |
| `repair_instruction()` (`:563`;RULE 1 文案 `:610`、RULE 9 文案 `:636`) | repair 提示词硬写了页数公式 / maxChars 规则 | **同步改**:删 RULE 9 段;RULE 1 改"按实际页数" |
| `_expected_page_count` 的调用方(`coerce` / `build_text_first_layout` 补页 `:779`) | 按公式补/裁页 | 改为按实际分组页数;text-only 补页逻辑随页数语义调整 |
| 渲染层 `web-utils.tsx:43` / `pdf-utils.tsx:72` | 已 `object-fit: cover`(两端一致) | **D-A 基本满足**;显式 center-cover,不做人脸避让,不设比例硬容差 |
| `design.md §4.3 / §5.1` | orientation 硬规则 + quality 边界 case + 页数公式 + 文案 maxChars | 改写:orientation/quality(除 hero 保护)软化;页数→实际;文案长度→软参考;cover 语义入文档 |

> 组合优化收益:orientation 软化 + 页数转实际后,留给弱模型的硬约束只剩 **hero 保护 / 首页 cover / 覆盖(每图≥1)/ 同页不重复 / slot key / pageIndex 连续**。repair、coerce 从"主力"退成"摆设"(退化但不删)。

---

## 5. 待定项(开工前必须清空)

- ~~[待定 Q1] quality(画面分量)~~ ✅ **已锁(用户:"注意哦,Hero")**:**保留 hero 保护** —— `quality` 仍区分 hero/detail/fill,**fill 级缩略图禁止进满版 hero 槽**(确定性轻校验保留)。其余分量匹配走模型软偏好。hero 是叙事担当,不能被远景小图占。
- ~~[待定 Q2] 尾页 closing 规则~~ ✅ **已解** → 见 D-D(从 group 挑,不设硬规则)。
- ~~[待定 Q3] 页数规则~~ ✅ **已锁(用户:"必须按实际页数计算")**:**废弃** `max(3, ceil(n/2.5))` 死公式。页数 = **实际页数**(由内容 / 分组 groups 实际排出多少页就是多少页)。`violation()` Rule 1 从"== 公式"改成**仅 sanity 边界**(≥1 页、首页 cover、pageIndex 连续);**牵连 chat-edit 校验**(同一套 `violation` 复用),必须一并回归。详见 §4。
- ~~[待定 Q4] cover 裁切方式 + 容差~~ ✅ **已锁**:本期 center-cover;不做人脸避让 / 焦点字段;不设比例硬容差,比例差由 cover 吸收。归 web 渲染层显式化。
- ~~[待定 Q5] 文案长度~~ ✅ **已锁(用户:"无硬性限制,推荐长度作参考")**:**取消文案长度硬校验**(`violation()` Rule 9 不再判违规)。每个模板的"推荐文案长度"由用户逐模块固定,**仅作参考喂进 prompt**。溢出处理交渲染层(web 文本自适应),不在 Agent 硬卡。`clamp_page_texts` 是否保留为"只缩不改义"的纯安全网 → 开工时按渲染能不能自适应再定,默认可留(只缩不报错,不构成"硬限制")。

---

## 6. 共享模板库(单一真相源)`[已锁位置]`

- 位置:**`packages/contracts/templates/`**(已锁定;物理目录 / README 推迟到 Task A 实施时创建)。
- 形态:一个模板一个 `<id>.json`,用户批量维护;Agent(Python)与 Web 两端都从这里读,取代 `templates.ts` 硬编码副本。
- 录入 schema、不变式由 Task A 在该文件夹 `README.md` 中落地;本 doc-gate 阶段只锁位置与语义。
- 开工后需:① 写 loader(两端读 JSON)② 把现 21 模板迁成 JSON ③ Agent/Web 改成读 loader。

---

## 7. Pipeline 流程图

```
┌──────────────────────────────────────────────────────────────┐
│ WEB 端                                                         │
│  收集照片 → base64 编码 + photoId + width/height              │
│  POST /v1/layout  { photos:[{photoId, base64, w, h}], prompt } │
└────────────────────────────┬─────────────────────────────────┘
                             │ (若只给图未给编码 → 入口确定性补 photoId,不交 LLM · D-E)
                             ▼
┌──────────────────────────────────────────────────────────────┐
│ AGENT(无状态)                                                │
│ ① vision (LLM·火山)                                          │
│    识别 / 分组 groups / orientation 提示 / quality / 文案素材  │
│    out: PhotoAnalysis[]  (+ 内部 groups,不进对外输出)        │
│ ② writing (LLM·DeepSeek)                                     │
│    title / subtitle / style    ← style 必落枚举,无"匹配不到"  │
│ ③ composing (LLM·DeepSeek)                                   │
│    按 style 选模板 / 把 photoId 塞 slot / 填文案              │
│    orientation·quality = 软偏好(prompt 引导,不硬卡 · D-B)   │
│    尾页从某 group 挑(暂定 · D-D)                            │
│    out: 仅 photoId,绝不 URL(D-E)                            │
│ ④ 确定性收尾层(代码硬做,保证确定 · D-E)                    │
│    coerce 分配 / clamp 文案(软) / violation 校验 / photoId 回填│
│    硬约束:hero保护·首页cover·pageIndex连续·每图≥1·同页不重复·slot key│
│    页数 = 实际排出页数(非公式 · Q3);文案长度=软参考(Q5)   │
└────────────────────────────┬─────────────────────────────────┘
                             │ callback: AlbumLayoutPlan
                             │  pages:[{templateId, images:{slot:photoId}, texts}]
                             ▼
┌──────────────────────────────────────────────────────────────┐
│ WEB 端 渲染(React 预览 + @react-pdf 导出,两端一致)         │
│  按 templateId 读共享模板库 JSON;photoId → 本地 IndexedDB 取「原图」│
│  最终渲染用原图(非预览图 · §1 铁律);object-fit: cover 作用于原图│
│  image slot: cover(裁满不变形,裁切在模板内·D-A)            │
│  [TODO·web] 显式 center-cover;不做人脸避让/比例硬容差(§3)   │
└──────────────────────────────────────────────────────────────┘
            ▲ 读                                  ▲ 读
            └──────────────┬───────────────────────┘
                           │
            ┌──────────────┴───────────────┐
            │ 共享模板库(单一真相源 · §6)  │
            │ packages/contracts/templates/ │
            │  <id>.json × N(用户批量维护) │
            └──────────────────────────────┘
```

---

## 8. 同步清单(开工后)

- [x] `design.md §4.3 / §5.1` 改写 orientation/quality 约束语义
- [x] `architecture.md` 增补本次二期决策(cover 缩放 + orientation 软化 + 模板录入简化)
- [x] `contract.md` 确认对外契约未变(预期不变,仅复核)
- [x] web 轨道交接:§3 的 center-cover 视觉模块需求

---

## 9. 这份文档是什么 + 交接(给「技术方案」窗口)

### 9.1 定位
本文档 = **对齐契约 + 决策记录 + 影响面地图**(设计方案的**前半段**)。它**不是**可照着施工的技术方案。下个窗口据此产出「施工技术方案」,再开工。

### 9.2 已定(本文档已锁,技术方案窗口**直接采用,别重议**)
- 决策 **D-A**(cover)/ **D-B**(orientation 软,模型侧)/ **D-C**(style 必匹配)/ **D-D**(尾页从 group)/ **D-E**(输入·输出·收尾)。
- **图片双表示**:预览图 ≠ 原图,最终渲染用原图(§1 铁律)。
- 页数 = **实际**(废公式)、文案长度 = **软参考**、**hero 保护保留**。
- 共享模板库位置 = `packages/contracts/templates/`。
- 渲染层 cover **两端已就位**(`web-utils.tsx:43` / `pdf-utils.tsx:72`),本期只显式 center-cover;不做焦点 / 人脸避让,不设比例硬容差(归 web)。

### 9.3 技术方案窗口**必须补全**的(本文档缺的后半段)
1. **执行顺序 + 任务拆分 + 依赖图**:loader / `violation` 改写 / 模板迁移 / prompt 改 / web center-cover 显式化,谁先谁后。
2. **数据形态完整规格**:
   - `groups` 在 vision→composing 怎么表达与流动(**内部结构,不进对外 `AlbumLayoutPlan`**)。
   - **模板 JSON schema 定稿**(把 `templates/README.md` 草案钉死:`styles` / `recommendedMaxChars` 语义、可选约束默认值)。
   - **loader 设计**:Python(Agent)+ TS(Web)两端读同一批 JSON,与现有 `web-registry.ts` / `pdf-registry.ts` 怎么对齐。
3. **`violation()` 新规则的代码形态**:Rule 1 改 sanity 边界、删 orientation、删 Rule 9、保留 hero 的轻校验——写到能直接落代码的程度。
4. **`repair_instruction()` 同步改法**(`:563` / RULE 1 `:610` / RULE 9 `:636`)。
5. **迁移步骤**:21 模板 → JSON,不破坏现有渲染;一次切还是灰度。
6. **测试 + 验收**:chat-edit 回归(复用同一 `violation`)、1 图 fixture、center-cover 预览/PDF 目检、页数实际化后的边界 case。
7. **prompt 改动**(composing/writing:orientation 软引导 / style / 尾页 group / 推荐文案长度喂入)。注意**真实 prompt 在本仓库 Agent 内,非 showcase 桩**。

### 9.4 待定项状态

Q1 / Q4 均已关闭:hero 保护保留;cover 采用 center-cover,不做人脸避让 / 焦点字段,不设比例硬容差。

### 9.5 流程闸门(CLAUDE.md 硬要求)
按 `CLAUDE.md`:**改 schema / 改 Web↔Agent 协议 / 加 `packages/*` 子结构 / 改不变式 → 必须先过架构师**,并在 `architecture.md` 登记。本次动到**模板 schema、确定性校验、新增 `templates/` 目录** → 技术方案窗口应**先走这道架构师闸门**(§8 已含 `architecture.md` 登记项)。
