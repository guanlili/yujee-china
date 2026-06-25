# Memoir-Agent 重构 — 端到端系统蓝图(框架级,v2)

- 日期:2026-06-26
- 状态:框架蓝图 v2(已并入 boss 决策;Stage 3 待专门讨论)
- 高度:**只到"环节间数据契约 + 大流程串通 + skills 视角",不含内部算法/prompt/token**。
- 图例:REUSE 复用 · EXTEND 加字段 · NEW 新契约 · DECISION 待拍板(§6)

---

## 0. Skills(能力)视角

agent 能力按 skill 组织,被各环节调用(一处实现、多处复用):

| skill | 谁执行 | 用在哪 |
|---|---|---|
| 章节描述 | 豆包视觉 | Stage1 describe |
| 图片描述 | 豆包视觉 | Stage1 describe |
| 排版(选版式+分槽) | Gemini 多模态 | Stage2、Stage3 case4(同一可复用模块) |
| 写文(引导/写作) | DeepSeek | Stage3 case1/2、Stage5 文案 |
| 颜色设计 | AI + 「颜色设计」skill | 章节色=AI 设计(Stage4,吃 Stage1 1d 提取色作依据)/ 封面色=AI 设计(Stage5,吃封面照片提取色作依据)—— 同一套模型 | Stage4 章节色、Stage5 封面色 |
| 字体设计 | DeepSeek | Stage4 |
| (代码) `accent_color` 颜色识别 | 代码 | Stage1 1d 出提取色 `extractedColor`(`accent_of_group`,喂 AI 设计,非最终色);Stage5 封面色用 `accent_from_photo` 从封面照片出提取色喂 AI 设计 —— 章节色 + 封面色两者 |
| (代码) `finalize_color` 统一颜色函数 | 代码 | 归一化 AI 设计出的色为最终 hex —— 章节色 Stage4 + 封面色 Stage5 两者 |
| (代码) 填文案 / 刷色 | 代码 | 单页编辑、apply-theme、Stage5(同一套) |
| (代码) `skeleton_v3` 合法性兜底 | 代码 | Stage2、Stage3 case3/4 |
| (代码) 简易 id 映射 | 代码 | 所有"喂数据给 LLM"处 |

---

## 1. 端到端流程

```
浏览器(原图、EXIF、base64@800px/200px、用户选择[含封面照片])
  │ base64 + clusterId + takenAt + promptHint
  ▼
STAGE 1 识图章节  (Agent,异步 /v3/analyze + callback)
  1a 分组算法[代码]   确定性分章 → 产生「余量图」          ★算法稍后由 boss 补
  1c describe[豆包]   章节描述 + 逐张图片描述;输入=1a 的确定性分组(★输入无描述);按章批量、同章不切
  1b 余量图归组[DeepSeek] 无法分的图归入章节(简易 id)
  1d 颜色识别[代码]   章定稿后从整章图片组确定性提真实主色 → chapter.extractedColor(提取色,依据非最终色;参考 accent_color.py)  ★取色数值 boss 定
  → V3LayoutTree(章节含 photos+图片描述;extractedColor=1d 提取色;accentColor=null 待 Stage4 AI 设计;artFont=null 待 Stage4;★无 pages)
  ▼ callback 仅 tree(★去 pages)→ Web 存 draft_json={tree,progress}
STAGE 2 选版式  (Agent,NEW /v3/select-layout,按章/簇批量调,★绝不切开同章)
  2a Gemini 排版[Gemini] 200px真图+模板预览图+结构描述 → templateId+图→槽(★不出色)
  2b 合法性兜底[代码]    钳/修;逐单元局部降级(只重算失败的)
  2c wrap+generic[代码]  加封面封尾 + folio/date
  → pages[] → Web 合并 draft_json.pages
  ▼
STAGE 3 编辑对话 agent loop  (★需专门讨论,小型 agent,见 §7)
  ▼
STAGE 4 设计(主题)  (Agent,/v3/recommend 改造 + /v3/apply-theme)
  整体 3 组(字体+颜色+整体风格)[DeepSeek] 全书级,AI 用「颜色设计」skill 吃 Stage1 1d 提取色作依据 → 用户选 1
  finalize_color[代码] AI 设计出的章节色 → 归一化最终 hex(chapter.accentColor)
  apply-theme[代码] 把选中字体 + 最终色刷进 pages
  ▼
STAGE 5 封面+封尾  (Agent,/v3/cover 改造,交互)
  封面照片【浏览器选】
  5a 文案[DeepSeek] 封面/封尾文案;问用户填什么(交互)
  5b 配色[代码识别提取色 accent_from_photo + AI「颜色设计」skill 设计封面色] 同章节色一套模型
  5c 落地[代码] finalize_color(归一化封面色) + 刷文案/刷色 ★复用单页那套函数(只是把分开步骤统一)
  ▼
/v3/finalize[代码] 拍平 tree+pages → AlbumLayoutPlan(★外部契约不变)→ 浏览器出 PDF
```
交互点:Stage3 全程、Stage4 选 1/3、Stage5 问填什么。

---

## 2. 逐环节 输入/输出契约(Stage 3 见 §7)

### Stage 1 识图(`/v3/analyze` 异步+callback)
| 子步 | 输入 | 输出 | 归属 |
|---|---|---|---|
| 1a 分组算法 | `V3AnalyzeRequest.photos[]`(photoId/base64/wh/clusterId?/takenAt?) | NEW `GroupingResult{chapters:{chapterId,photoIds[]}[], unplacedPhotoIds[]}` | 代码(算法 boss 补) |
| 1b 余量图归组 | NEW `{chapterDescs:{simpleId,text}[], photoDescs:{simpleId,desc}[], unplaced:{simpleId}[]}`(简易id,代码反映射) | NEW `{assignments: simpleId→chapterSimpleId}` 合并进分组 | DeepSeek+代码 |
| 1c describe | **1a 确定性分组(每章 photoIds + 图,★输入无描述)** + language + promptHint;按章批量、同章不切 | **章节描述 + 逐张图片描述**;代码补 wh/orientation/takenAt | 豆包+代码 |
| 1d 颜色识别 | 各章 photoIds 对应图(base64,与 1c 同源)+ base64 | `chapterId → "#RRGGBB"` 提取色(`accent_of_group`,整章聚合确定性识别;参考 accent_color.py;依据非最终色) | 代码(数值 boss 定) |
| 结果 | 合并 | `V3LayoutTree`(REUSE;`chapter.extractedColor=1d 提取色`/`accentColor=null 待 Stage4`/`artFont=null`;★无 pages) | 代码 |

★契约变更:callback 去掉 pages(今天 `V3AnalyzeCompleted.pages` 必填)。

### Stage 2 选版式(`/v3/select-layout` NEW)
| 子步 | 输入 | 输出 | 归属 |
|---|---|---|---|
| 2a Gemini 排版 | NEW `SelectLayoutRequest{chapters:{chapterId,photos:{photoId,200px,orientation}[]}[], candidates:V3TemplateCandidate[]+预览图, 结构描述}`(候选容量≤章节图数,多章取章内最大);**按章/簇批量、同章不切** | NEW `LayoutIntent{pages:{chapterId,templateId,slots:{slotId→photoId}}[]}` ★无色 | Gemini |
| 2b 合法性兜底 | LayoutIntent + 章节图 | 合法 `Page[]`;局部只重算失败章/页 | 代码 skeleton_v3 |
| 2c wrap+generic | interior Page[]+tree | 全 Page[](含封面封尾)+folio/date | 代码 |
| 结果 | — | `Page[]` → Web 合并 draft_json.pages | 代码 |

### Stage 4 设计(`/v3/recommend` 改造 + `/v3/apply-theme`)
| 子步 | 输入 | 输出 | 归属 |
|---|---|---|---|
| 整体 3 组 | EXTEND `V3RecommendRequest`(chapters:V3ChapterOverview[]+extractedColor? + analysisSummary? + NEW fontHint?) | NEW `bookThemeOptions:{optionId, artFont, palette, style}[3]`(★字体+颜色+整体风格,AI 用「颜色设计」skill 吃提取色作依据)→ 用户选 1 | DeepSeek |
| apply-theme | EXTEND `V3ApplyThemeRequest`(chosen 字体 + 最终色 + pages[]) | `layoutPatch[]`(刷字体 + 刷色;accentColor = Stage4 AI 设计经 finalize_color 的最终值) | 代码 apply_theme_v3 |

★Stage4 出最终颜色(章节 accentColor):AI 用「颜色设计」skill 拿 章节描述 + Stage1 1d 提取色作依据设计,经 finalize_color 归一化;Stage4 同时出字体 + 整体风格。

### Stage 5 封面封尾(`/v3/cover` 改造,交互)
| 子步 | 输入 | 输出 | 归属 |
|---|---|---|---|
| 5a 文案(交互) | EXTEND `V3CoverRequest`(coverTemplateId?/endingTemplateId? + NEW **coverPhoto(浏览器选,200px)**/hint/userMessage/history) | NEW coverTexts/endingTexts + assistantReply(可能提问) | DeepSeek |
| 5b 配色 | 选中封面照片(200px) | 提取色(代码 `accent_from_photo`)→ AI「颜色设计」skill 设计封面色 | 代码识别 + AI 设计(同章节色一套) |
| 5c 落地 | 文案 + AI 设计封面色 | `layoutPatch[]`:**复用单页填文案/刷色函数** + finalize_color 归一化 | 代码 |

---

## 3. 贯穿管线的共享数据对象(字段级累积)

唯一真相 = Web `albums.draft_json` = `V3StoryDraft{version, tree, pages?, progress}`。
```
Stage1 → tree.chapters[].{chapterId, description, extractedColor:1d提取色(★依据,确定性hex), accentColor:null(待Stage4), artFont:null,
                          photos[].{photoId, imageDescription, width,height,orientation,takenAt}}  (★无 pages)
Stage2 → + pages[].{pageIndex, templateId, images:{slotId→photoId}, texts:{}空, imagePos?} + 封面封尾页 + folio/date
Stage3 → pages[].texts 填(case1/2);images/templateId 改(case3/4);页数可增(case4);progress 演进
Stage4 → tree.chapters[].{artFont:选定, accentColor:AI颜色设计经finalize_color(吃Stage1提取色作依据)};subject 写 title 槽
Stage5 → 封面封尾 texts(文案)+ 封面色(同章节色一套:代码 accent_from_photo 出提取色 → AI「颜色设计」skill 设计 → finalize_color 归一化)
finalize→ 拍平 → AlbumLayoutPlan{magazine,photos[],pages[]}(★不变)
```
规则:字留在 tree(chapter 级),`extractedColor` 在 Stage1 1d 即定(依据),`accentColor` 由 Stage4 AI 设计经 finalize_color 填,finalize 才烘进 `Page.texts`;扁平 `Page`/`AlbumLayoutPlan` 不加新字段,渲染契约冻结。

---

## 4. Web↔Agent 边界

| Stage | 端点 | 同步? | 请求带 | 响应带 | 图 |
|---|---|---|---|---|---|
| 1 | `/v3/analyze` | 异步+callback | base64@800px、clusterId、takenAt、hint | callback 仅 `tree`(★去 pages) | 800px |
| 2 | **`/v3/select-layout` NEW** | 异步(按章/簇批量) | 200px真图+模板预览+tree切片 | `pages[]` | 200px |
| 3 | `/v3/chapter-chat`(+工具) | 同步 | 见 §7 | 见 §7 | case4 重发200px |
| 4 | `/v3/recommend`,`/v3/apply-theme` | 同步 | 文字概览;选择 | 3组→选;layoutPatch | 无 |
| 5 | `/v3/cover` | 同步(交互) | 模板id + 封面照片(200px,浏览器选)+hint+history | 文案+色 patch(或提问) | 200px |
| 出 | `/v3/finalize` | 同步 | tree+pages | `AlbumLayoutPlan` | 无 |

需标契约变更:① analyze callback 去 pages;② 新增 `/v3/select-layout` + 模板预览资源;③ **AI 自主推进/提交归属(§8.3)= DECISION**,见 §6-1 + §7。

---

## 5. 共享组件接口(只签名)

```
gemini_layout({units:[{chapterId, photos:[{photoId,ref200px,orientation}],
               candidates:[{templateId,previewImage,V3TemplateCandidate}]}],
               结构描述, mode:"select"|"case4-swap", allowAddPages:bool})
  -> {pages:[{chapterId,templateId,slots:{slotId→photoId}}]}      # 只意图,★无色 → 接 skeleton_v3 兜底

accent_of_group(photoIds, photos_by_id) -> "#RRGGBB"               # Stage1 1d 颜色识别:整章聚合确定性出提取色(参考 accent_color.py);依据非最终色,喂 Stage4 AI 设计
accent_from_photo(...) -> "#RRGGBB"                                # 单图确定性识别出提取色;Stage5 封面色用它从封面照片出提取色喂 AI 设计
finalize_color(设计色) -> "#RRGGBB"                                # 归一化 AI 设计出的色为最终 hex(章节色 Stage4 + 封面色 Stage5,同一套)
fill_texts(page, texts) / apply_color(page, color) -> page         # 单页编辑/apply-theme/Stage5 共用
to_simple(realIds)->{simpleIds,map}; from_simple(simpleIds,map)->realIds
skeleton_v3: legal_candidates / pick_template_v3 / assign_images_v3 / validate_grouping / 覆盖校验
```

---

## 6. 开放接口问题

| # | 点 | 状态 |
|---|---|---|
| 1 | **stage 推进 / 提交归属**:AI 出意图、谁提交(Web?Agent?)+ agent 是否仍无状态 | ❓ **boss 要专门讨论(并入 §7 Stage3)** |
| 2 | 章节色归属 | ✅ **已定 = 识别+设计两段**:颜色识别 = Stage1 1d 代码出提取色(参考 accent_color.py,依据);颜色设计 = Stage4 AI「颜色设计」skill 吃提取色出最终色,经 finalize_color;3 组 = 字体+颜色+整体风格 |
| 3 | 封面照片来源 | ✅ 浏览器选 |
| 4 | 工具 I/O + function-calling | ✅ 分批设计:先锁信封,内部后置(进 §7 讨论) |
| 5 | `finalize_color` 逻辑 | ⏳ **保留**:归一化 AI 设计出的色为最终 hex(章节色 Stage4 + 封面色 Stage5,同一套)。逻辑 boss 待给,先锁签名 |
| 8 | 封面色取色方式 | ✅ **已定 = 与章节色同一套模型**:颜色识别=代码(`accent_from_photo` 从封面照片出提取色)+ 颜色设计=AI「颜色设计」skill(吃提取色设计封面色)+ finalize_color 归一化最终 hex。封面文案仍 DeepSeek |
| 6 | Stage2 异步形态 | ✅ 按章/簇批量调,**绝不把同 chapter 的图切到下一批**;同步批 vs 独立 job 详设定 |
| 7 | 进度词表 V3JobStage | 跟随 §6-6,详设定 |

---

## 7. Stage 3 编辑对话(★需专门讨论 —— 占位)

boss:此环节是**小型 agent**,现有设计有不合理处,需专门讨论后再定。已知约束(待讨论会细化):
- DeepSeek 主脑,4 case(写章/页改写/换图/换版式),case4 复用 Gemini 排版(可加页)。
- 工具(分批设计):①页面信息 ②分章检索 ③版内换图 ④换版式。
- 进度代码算 → 给 AI;**AI 自主判断章节/页结束推进**;**提交归属(AI/Web/Agent)= §6-1,本节一并定**。
- AI 按需看对话历史。

case/工具/状态/提交/循环控制 在专门设计会确定,本蓝图先占位。
