# 详设：Stage 1 识图章节（分组 → 余量归组 → describe → 装配 tree）

- 日期：2026-06-26
- 状态：详设（板块架构师产出，待 boss 复审）
- 高度：**只到接口 / 数据流 / 装配 / 契约层**。不写 prompt 文案、不写分组算法本体、不写 token 数字。
- 上游真相：蓝图 `2026-06-25-agent-system-blueprint.md` §1/§2 Stage1、§3 数据对象、§4/§5 边界。本文只**接地与细化**，不重定边界。
- 引用不重设：`finalize_color` / `to_simple`/`from_simple`（简易 id）/ `skeleton_v3` / `gemini_layout` 等共享件签名以「共享板块」为准（蓝图 §5），本文只引用。

---

## 0. 本板块在端到端里的位置

```
浏览器(base64@800px、wh、clusterId?、exif.takenAt?、promptHint)
  │  POST /v3/analyze (异步 202 + callback)
  ▼
Stage1  flows/analyze.py 编排
  1a 分组算法[代码]         确定性分章 → GroupingResult{chapters, unplacedPhotoIds}   ★算法本体 boss 补,本文锁契约
  1c describe[豆包]         按章批量 → 章节描述 + 逐张图片描述(★输入无描述)
  1b 余量图归组[DeepSeek]   把 unplaced 用「章节描述 + 图片描述」归入已有章节(简易 id)
  1d 颜色识别[代码]         章定稿后,从整章图片组确定性提真实主色 → chapter.extractedColor(提取色,依据非最终色)   ★取色数值 boss 定,本文锁契约
  → 装配 V3LayoutTree(chapter.extractedColor=1d 提取色;chapter.accentColor=null 等 Stage4 设计;artFont=null 等 Stage4;★无 pages)
  ▼  callback 仅 tree(★去 pages)
Web  draft_json = {version, tree, progress}    (★无 pages,Stage2 才有)
```

子步执行**顺序**是本设计的关键决策(见 §4):**1a → 1c → 1b**。1b 需要描述才能归组,而描述由 1c 产出,故 1b 必须在 1c **之后**;但 1c 又需要确定的「章」来分批,故 1c 在 1a **之后**。余量图(unplaced)在 1c 阶段单独成一个"余量批"也要 describe(它们也要有图片描述,1b 才好归;归好后它们要在所属章里有描述)。

---

## 1a 分组算法(代码 · 算法本体后补)

### 职责
把 `V3AnalyzeRequest.photos[]` 确定性地分成若干**章**,并吐出**无法自信归章的余量图**。**只分组,不读图、不写任何描述**(描述是 1c 的事)。

### 输入
- `photos: list[V3AnalyzePhoto]` —— 取 `photoId / width / height / clusterId? / exif.takenAt?`。
  - ★ 算法**不消费 base64**(分组是确定性的:靠 clusterId / takenAt / 顺序等信号)。base64 留给 1c。

### 输出(NEW 数据对象,本文锁定)
```python
@dataclass(frozen=True)
class GroupingResult:
    chapters: list[GroupingChapter]      # 确定性分好的章(保输入顺序)
    unplacedPhotoIds: list[str]          # 无法自信归章的余量图(可空)

@dataclass(frozen=True)
class GroupingChapter:
    chapterId: str                       # 本阶段稳定本地 id:ch_1, ch_2, …(顺序)
    photoIds: list[str]                  # 该章成员,按输入(时间/cluster)顺序
```

### 不变式(本文要求算法本体满足,做兜底校验)
- **覆盖且互斥**:`flatten(chapters[].photoIds) ∪ unplacedPhotoIds` == 全部 `photoId`,且无重复、无未知 id。
- **保序**:章内 photoId 保持全局 cluster/时间顺序(相册=时间顺序回忆录)。
- **cluster 不跨章**:同一非 null `clusterId` 的照片不被拆进两章(沿用现 handler 的 cluster 边界硬约束)。
- **退化**:`chapters` 至少 1 章(全是余量的极端情形,算法应兜底归一章或全进 unplaced 交 1b;由本体决定,校验只断言覆盖)。

### 占位接口(算法本体后补)
```python
# apps/agent/src/agents/image_grouping/handler.py   (NEW agent,沿用三件套约定)
def group_photos(photos: list[V3AnalyzePhoto]) -> GroupingResult:
    """确定性分章 + 产出余量图。算法本体由 boss 补;本文只锁 I/O 契约 + 不变式。
    占位实现:可先委托 skeleton_v3 既有按容量/顺序的确定性分章,unplaced 暂为 []。"""
    ...
```

> 落点:新建 `apps/agent/src/agents/image_grouping/`(与现有 `image_understanding` 平级)。`GroupingResult` 就近放 `image_grouping/schema.py`。flows 引用之。

---

## 1c describe(豆包视觉 · 按章批量,同章绝不切)

### 职责
读图,产出**两类描述**(对应蓝图 §0 两个 skill):
- 每章 `description`(章节描述)
- 每张照片 `imageDescription`(图片描述,对应现 `V3ChapterPhoto.sceneDescription` 字段)

★ **输入无描述**:1c 拿到的是 1a 的确定性分组(每章 photoIds + 图),自己生成描述。
★ **瘦身**:1c **不再产出 pages / templateId**(那是 Stage2 的事)。详见 §「describe 瘦身」。

### 输入
```python
describe_chapters(
    grouping: GroupingResult,            # 1a 的确定性分章(★只给 photoIds 分组,无描述)
    photos_by_id: dict[str, V3AnalyzePhoto],   # 取 base64 + wh + exif
    *, language: V3Language,
    prompt_hint: str | None,
) -> DescribeResult
```
余量图(`unplacedPhotoIds`)也要 describe(它们需要图片描述给 1b 归组用),作为一个**独立的"余量批"**喂模型:只要逐张图片描述,**不要**章节描述(它们还没有章)。

### 输出(NEW,本文锁定)
```python
@dataclass(frozen=True)
class DescribeResult:
    chapterDescriptions: dict[str, str]          # chapterId(1a 的本地 id) → 章节描述
    imageDescriptions: dict[str, str]            # photoId → 图片描述(含余量图)
```
代码随后补 `width/height/orientation/takenAt`(只来自请求,从不经 LLM 往返;沿用现 `_assemble` 的"LLM 只写文字、属性代码填"原则)。

### 同章不切的批处理规则(★替代纯数字阈值)

现 handler 用"张数阈值 → 1/2/3 路并发 + 整簇装箱"。新规则**以章为不可分单元**:

1. **单位 = 章**(`GroupingChapter`)。一章的所有照片必须在**同一次模型调用**里出现,**绝不跨批切开**。理由:章节描述需要看到本章全部照片才能写准;切开 = 同章描述前后矛盾。
2. **装箱**:按章用 first-fit-decreasing(大章优先)装进 N 条并发路由,**章不跨路由**。路由数 N 由"总张数 / 每路由软上限"推导(软上限可调,但**任何单章超过软上限也整章独占一路,不拆**)—— 即软上限是**装箱的目标**,不是**切章的阈值**。
3. **余量批**单独成一条路由(或并入最轻路由),它内部**逐张独立**(无章约束),可按软上限再切;余量图之间无"同章"关系。
4. 合并:各路由产出 `chapterDescriptions`/`imageDescriptions` 片段,按 chapterId 直接并(章 id 全局唯一,1a 已统一编号,**不需要**现 handler 那套"路由内 ch_1 重号 + 跨路由重排")。

> 这是对现 `_partition_into_clusters` / `_plan_describe_routes` / `_route_count_for` 的**语义替换**:从"cluster 装箱、模型自由分章"变成"章已定、章装箱、模型只写描述"。cluster 的分章职责上移到 1a;1c 只负责"在已定章上写字"。

### 护栏(沿用 §8.3 精神,瘦身后)
- 每章 `description` 必须非空;每张照片 `imageDescription` 必须非空、≤300 字符(对齐 `V3ChapterPhoto.sceneDescription` 上限)。
- 漏/重/错认 photoId:沿用现有"升温在同 slot 重抽 ≤ N 次"安全网(`_is_recoverable_describe_error`),但**校验对象缩为"描述覆盖",不再校验分页/模板**。
- 简易 id:喂模型前 `to_simple(photoIds)`,取回 `from_simple(...)`(复用共享 helper,见 §共享边界),替换现 handler 内联的 `_remap_describe_photo_ids` / `model_copy(photoId=str(i+1))`。
- failover:OpenAI/豆包双槽 failover 策略不变(蓝图 §6.8;`vision_provider` 槽逻辑沿用)。

---

## 1b 余量图归组(DeepSeek · 文字 · 简易 id)

### 职责
把 1a 吐出的 `unplacedPhotoIds`,**纯文字**地按"章节描述 + 图片描述"归入**已有章节**。无法归的极端情形由本步兜底(见下)。

### 前置依赖(★顺序关键)
1b **必须在 1c 之后**:它的输入既要章节描述(判断归哪章),又要余量图的图片描述(判断这张像哪章)。两者都由 1c 产出。

### 输入(NEW,本文锁定 · 简易 id 空间)
```python
group_unplaced(
    chapterDescs: list[ChapterDesc],     # [{simpleId, text}]  已有章的描述(1c)
    photoDescs: list[PhotoDesc],         # [{simpleId, desc}]  余量图的图片描述(1c)
    unplaced: list[SimpleRef],           # [{simpleId}]        待归的余量图(冗余但显式)
    *, language: V3Language,
) -> UnplacedAssignments
```
- 喂 DeepSeek 的 id 全走**简易 id**(章用 ch1/ch2…、图用 1/2/3…),代码侧 `to_simple`/`from_simple` 反映射(共享 helper)。

### 输出(NEW,本文锁定)
```python
@dataclass(frozen=True)
class UnplacedAssignments:
    assignments: dict[str, str]          # photoId(real) → chapterId(real)  归并结果
```
- 模型对每张余量图给一个目标章简易 id;代码反映射成真实 id。

### 护栏 / 兜底
- 目标章必须 ∈ 已有章集合;幻觉章 id 的那张 → 兜底归"时间上最近的章"或末章(确定性,本文不定细则,留实现;只要求**每张余量图最终都有归宿**)。
- DeepSeek 失败 / 不可解析 / 无配置 → **整体兜底**:把所有 unplaced 确定性并入时间相邻章(不致命,预览永不崩)。
- 归并把余量图**插回所属章的保序位置**(按 takenAt / 全局顺序),保持"章内时间序"不变式。

> 落点:复用现有 `writing` 或新建 `apps/agent/src/agents/regroup_unplaced/`(DeepSeek slot)。三件套:handler(编排 + 简易 id + 兜底)、prompt.md(归组规则,**本文不写**)、复用 `ai_client` + DeepSeek 槽。

---

## 1d 颜色识别(代码 · 确定性 · 分章后 · 无模型无 API)→ 提取色 extractedColor

### 职责
章定稿后(1a + 1b 成员已最终确定),对**每一章的图片组**确定性地算出该章照片的**真实主色 = 提取色 `extractedColor`**。**纯代码逐像素,不调任何模型**。
★ **这是「识别 / 依据」,不是最终颜色**:`extractedColor` 写进 tree 供 Stage4 做 AI 颜色设计时当依据,**不直接作为 `accentColor`**。最终章节色由 Stage4 的 AI(「颜色设计」skill)拿 章节描述 + 本步提取色 设计/推荐,再经 `finalize_color` 归一化得出。
代码化的只是「识别真实颜色」这一步(解决豆包凭文字瞎猜 / 取色发灰发丑:把天空/白墙/灰像素也算进去);AI 审美仍在 Stage4 保留。参考 `accent_color.py` 核心逻辑。

### 输入
- 每章的图片组(该章 photoIds 对应的图)+ base64(请求已带,与 1c 同源像素;下采样即可,如 80×120 / 70×100)。
- ★ **整章聚合**取一个色(`accent_of_group`),比逐张稳。

### 算法(参考 `accent_color.py`,本文锁口径不锁数值)
1. 逐像素转 HSV;**丢掉**近白(v>V_HI 且 s<S_HI,天空/白墙)、近黑(v<V_LO)、近灰(s<S_LO)的像素 —— 它们无有意义色相,留着把色冲成灰泥。
2. 剩下有彩像素按**饱和度加权**统计色相直方图(24 桶),整章所有图累计进同一组桶,取权重最大的主色相 H。
3. **丢掉照片自身的 S/V**,用**设计固定的 L、S**(如 L=0.42、S=0.50)重建颜色 → 全书亮度/饱和一致、天然协调、永远不丑。
4. 兜底:全灰/无有彩像素 → 中性色(如 "#8A8174")。
- 固定 L/S 与阈值(V_HI/S_HI/V_LO/S_LO)是**可调设计常量,最终值 boss 定**;本文锁"流程口径 + I/O",不锁数值。

### 输出
- `dict[str, str]`:chapterId → "#RRGGBB"(规范 6-hex 的**提取色**)。注:它是设计依据,不是最终 `accentColor`;写进 tree 的 `extractedColor` 字段,供 Stage4 使用。

### 位置与归属
- 在 Stage1、**1b 之后**执行(章成员含余量图已最终定);纯代码,放分组/识图同层(如 `engine/accent_color.py`,被 `image_grouping` 或 flows 调)。该组件定位 = **「颜色识别 / 提取」(产 extractedColor 喂 AI 设计),不是产最终色**。
- 产物直接写进 tree:`chapter.extractedColor = 1d 提取色`(NEW 字段);**`chapter.accentColor` 仍为 null,由 Stage4 填**。
- ★ **跨板块影响**:Stage4 设计环节**仍出最终章节色**(上一轮误删,本轮改回),但 AI 现在**以本步提取色为依据**做颜色设计;`finalize_color` 对**章节色**仍需要(AI 设计出的色经它归一化成最终 hex)。封面色(Stage5)**同模型已定**:代码识别(`accent_from_photo` 从封面照片出提取色)+ AI「颜色设计」skill 设计 + finalize_color 归一化,本文只标不改。

> 落点:`accent_of_group(photoIds, photos_by_id) -> "#RRGGBB"` 确定性纯函数,产**提取色**;算法本体参考 accent_color.py,数值常量 boss 定。

---

## 结果装配(代码)

把 1a(章 + 成员)+ 1b(余量归并)+ 1c(描述 + 代码补属性)合成一棵 `V3LayoutTree`(REUSE 现 schema):

```
V3LayoutTree.chapters[] = {
  chapterId,                       # ch_1..N(1a 本地 id,余量并入后保持)
  description,                     # 1c 章节描述
  extractedColor = "#RRGGBB",      # ★1d 颜色识别出的提取色(依据,非最终色;NEW 字段)
  accentColor = None,              # ★仍为 null,由 Stage4 AI 颜色设计 + finalize_color 填最终色
  artFont    = None,               # ★Stage4 设计环节填字体
  photos[] = {
    photoId,
    sceneDescription,              # ← 1c 图片描述(字段名沿用现 schema)
    width, height, orientation, takenAt,   # 代码补,只来自请求
  }
}
```

★ **无 pages**:装配产物只有 tree。`V3AnalyzeResult` 的 `pages` 字段**删除**(见 §契约变更)。

装配不变式(瘦身后,精简自现 `_assemble_v3_tree`):
- 每张输入照片恰好落入一个章(1a 覆盖 + 1b 归并后,代码再断言一次全局覆盖)。
- 章 description / 每图 sceneDescription 必须存在(代码绝不为 LLM 字段写兜底文案)。
- 章内照片保序;`extractedColor` 由 1d 颜色识别填(必为合法 6-hex 的提取色);`accentColor` 留 null(Stage4 AI 颜色设计 + finalize_color 填);`artFont` 留 null(Stage4 填)。

---

## describe 瘦身:对现 `image_understanding/handler.py` 的具体改动面

现 handler 是"统一 describe"(分章 + 描述 + 分页 + 选模板,合一)。Stage1 把它**瘦回纯描述**。改动面:



**留(瘦身后核心)**
- 读图 + 写章节描述 + 写图片描述 —— 1c 本体。
- 简易 id(改用共享 helper)、漏/重/错认重抽安全网、双槽 failover、隐私 redact(base64 用完即丢、不记录、不回传)。
- 代码补 `width/height/orientation/takenAt`。

**改签名**
- `describe_content(photos, language, prompt_hint) -> V3AnalyzeResult{tree, pages, …}`
  → `describe_chapters(grouping, photos_by_id, language, prompt_hint) -> DescribeResult{chapterDescriptions, imageDescriptions}`。
- `V3AnalyzeResult.pages` 字段删(或新 `DescribeResult` 取而代之);`V3DescribeResult` 别名相应更新。

> 现单元测试里凡断言 describe 出 pages/templateId 的用例需迁移/删除;断言"分章/描述/覆盖"的保留并改走 1a+1c。

---

## 契约变更(★需登记)

### C1 — analyze callback 去 pages(对 Web)
- `V3AnalyzeCompleted.pages` 现**必填**(`list[Page] = Field(min_length=1)`)→ **删除该字段**(或改 `pages: list[Page] | None = None` 过渡)。callback 只带 `tree`。
- TS 侧 `packages/contracts/src/v3.ts` 的 `V3AnalyzeCompleted` 同步去 `pages`(跨语言 parity,单一真相)。
- Web 影响:`draft_json` 在 analyze 完成后只写 `{version, tree, progress}`,**不再有 pages**;pages 由 Stage2 `/v3/select-layout` 后才合并进 `draft_json.pages`。Web 的"分析完成 → 进编辑器"渲染分支须容忍 `pages` 缺省(预览态画板改由 Stage2 填,或加载态等 Stage2)。**此改动归属 §6-1/§4 的边界,须 Web 板块 + 架构师确认**。

### C2 — flows/analyze.py 编排重写
- 三步串:`group_photos`(1a)→ `describe_chapters`(1c)→ `group_unplaced`(1b)→ 装配 tree。
- `_build_preview`(wrap cover/ending + generic_copy)**整段删** —— 封面/封底/folio/通用色属 Stage2/4/5,Stage1 不再产页。
- 进度词表 `V3JobStage = ["describe","group","template","preview"]`:Stage1 现只到"出 tree"。建议把节拍重映射为 `group`(1a)→ `describe`(1c)→ `group`(1b 复用)→ 不再有 `template`/`preview`。**词表变更跟随蓝图 §6-7,须架构师定**;过渡期可保留旧词表只发 `describe` 节拍以不破 Web 状态机。

---

## 与邻板块的边界(★只引用不重设)

| 边界 | 谁拥有 | Stage1 怎么对接 |
|---|---|---|
| **简易 id** `to_simple/from_simple` | 共享板块(蓝图 §5) | 1c/1b 喂 LLM 前后调用;Stage1 删内联 `_remap_*`/`model_copy` 那套,改引共享 helper |
| **Stage2(选版式)** | 消费 `tree`(★无 pages) | Stage1 callback 只交 tree;pages 由 Stage2 `/v3/select-layout` 产;`skeleton_v3`/`gemini_layout` 归 Stage2,Stage1 不再 import 分页/模板函数 |
| **Web(callback)** | `draft_json={tree,progress}`(★无 pages) | 契约 C1:callback 去 pages;Web 渲染容忍 pages 缺省 |
| **theme(Stage4)** | 出最终 `accentColor`(AI 颜色设计 + finalize_color)+ `artFont`(+ 整体风格) | Stage1 1d 只产 `extractedColor`(提取色,依据);Stage4 AI 拿 章节描述 + 提取色 设计最终章节色,经 `finalize_color` 归一化填 `accentColor` |

---

## 关键决策小结

1. 子步顺序 **1a → 1c → 1b → 1d**:1b 需描述(1c 产)、1c 需定章(1a 产),1d 取色需章成员最终定(1b 后),故顺序如此。
2. 1a **只分组不读图**(不吃 base64);describe 全归 1c;cluster 边界 + 分章职责从现 handler **上移到 1a**。
3. 1c **按章装箱、同章绝不切**:软上限是装箱目标而非切章阈值;余量图单独成批、内部逐张。
4. describe **瘦身**:删分页/选模板/容量表/cover-wrap/generic-copy/flatten,只留"读图写两类描述 + 代码补属性 + 简易 id + failover + 隐私"。
5. **1d 颜色识别 = 纯代码确定性出提取色**(参考 accent_color.py):整章聚合、丢天空/白墙/黑/灰、饱和度加权取主色相、固定 L/S 重建 → 产 `extractedColor`(真实主色,**作依据**);**它不是最终色**,最终章节色由 Stage4 AI 用提取色做颜色设计得出。
6. 装配产物**只有 tree、无 pages**;`extractedColor` = 1d 提取色(确定性 hex),`accentColor` 仍 null(待 Stage4),`artFont` 留 null(Stage4)。
7. **章节最终色由 Stage4 出**:Stage4 AI(「颜色设计」skill)用 1d 提取色做依据设计最终章节色,经 `finalize_color` 归一化;Stage1 只负责颜色识别(出提取色)。
8. callback **去 pages**(C1)+ flows 编排重写(C2):跨 Web/架构师边界,须确认。
