# Stage 4 设计(主题:颜色 + 字体 + 整体风格)— 详设

- 日期:2026-06-26
- 状态:详设 v3(★恢复「AI 做颜色设计」:Stage4 仍出最终颜色 + 字体 + 整体风格;AI 现以 Stage1 1d 提取色为依据)
- 上游蓝图:`2026-06-25-agent-system-blueprint.md` §1/§2 Stage4、§0 skills、§5 共享组件、§6-2
- 真相源(颜色分工):`2026-06-26-detail-stage1.md` §1d「颜色识别」—— Stage1 1d 纯代码确定性识别出**提取色 `extractedColor`**(参考 accent_color.py),它是**依据,不是最终色**;**最终 `accentColor` 由 Stage4 AI 颜色设计 + finalize_color 出**。
- 接地代码:
  - `apps/agent/src/agents/theme_recommend/handler.py`(recommend 现状:逐章 subject+色+字)
  - `apps/agent/src/agents/theme_recommend/recommend_theme.md`(prompt 资产,本详设不改 prompt;颜色规则 `prompts/rules/theme_colors.md` 仍用,只是 AI 现额外吃提取色作依据)
  - `apps/agent/src/engine/apply_theme_v3.py`(确定性刷字体 + 刷色;accentColor 来自本环节 AI 设计经 finalize_color)
  - `apps/agent/src/schemas.py`(契约真相源,§ enums / v3.ts recommend / apply-theme / theme carriers)
- 高度:**只到接口 / 契约 / 刷字体 + 刷色层**。prompt 文案、token、failover 实现细节不在此。

> 共享件「简易 id 映射」(蓝图 §0,代码)以**共享板块**为准,本详设**只引用、不重设**。`finalize_color()` 恢复角色:AI 设计出的颜色经它归一化为最终 hex(章节色用),本环节调用。

---

## 0. 范围与已定决策(回顾)

- DeepSeek 出**整体 3 组(字体 + 颜色 + 整体风格),全书级**,非每章 → 用户选 1。**★恢复出颜色**(上一轮误删):每组含全书颜色方案;AI 用「颜色设计」skill。
- **章节 accentColor 由本环节出**:AI 拿 **章节描述 + Stage1 1d 提取色 `extractedColor`** 作依据 → 设计/推荐最终章节色,经 `finalize_color` 归一化成最终 hex。提取色解决「凭文字瞎猜 / 豆包取色丑」,AI 审美仍在。
- **本环节调 `finalize_color()`**:AI 设计出的颜色经它归一化为合法 hex(章节色)。
- `apply-theme`(确定性刷)把选中字体 + 颜色刷进 pages。适配「3 组选 1」新入参(§5)。
- 模型从视觉槽切到 **DeepSeek**(纯文字任务,§6);提取色作为文本/hex 依据随请求传入(非 base64)。
- 字体沿用固定 4 字体列表(`ArtFontPack`)+ hint。

---

## 1. Stage4 子流程(全书级 3 组 → 选 1 → 刷字体+色)

```
[A] recommend(DeepSeek,改造)   全书概览(章节 overview + extractedColor 提取色 + analysisSummary + fontHint?)
      → bookThemeOptions:{optionId, artFont, palette(颜色), style(整体风格)}[3]   ★字体+颜色+风格(AI 以提取色为依据)
      → assistantReply
   ▼ 用户在 Web 选 1（交互点,Web)
[B] finalize_color（代码,共享）  AI 设计出的颜色 → 归一化最终 hex（章节 accentColor）
[C] apply-theme（代码,改造）     选中字体 + 最终色 → layoutPatch[]
                                 artFont 落 chapter（树）、accentColor 落 chapter（树)、subject 落 title 槽（页)
   ▼ Web 合并 + 推进 stage theme→cover
```

边界:**[A] AI 出颜色设计 + 字体意图、[B] finalize_color 归一化最终色、[C] 保合法刷字体+色、Web 提交并推进 stage**(沿用现状:recommend 不推进 stage,见 handler.py 顶注)。

---

## 2. recommend 请求 / 响应(改造)— 全书级 3 组

### 2.1 请求(EXTEND `V3RecommendRequest`)

复用现有 `V3RecommendRequest` 主体,只加一个可选 `fontHint`:

```
V3RecommendRequest {
  albumId: str
  language: V3Language
  chapters: V3ChapterOverview[]    # EXTEND:每章 {chapterId, description, photoDescs[], extractedColor?}
  analysisSummary?: str(≤1000)     # REUSE
  userMessage?: str(≤500)          # REUSE(用户引导,例如 "想要暖一点")
  fontHint?: str(≤200)             # NEW(蓝图 §2 表):字体倾向自由文本,非强约束
}
```

- `chapters` 仍是全书章节概览 → 模型据此做**全书级**判断(每组给一套字体 + 颜色方案 + 整体风格),不再「按章各推一条」。
- ★ **`V3ChapterOverview` 新增 `extractedColor?`**(Stage1 1d 提取色,6-hex):AI 颜色设计的**依据**(每章真实主色),AI 据此设计最终配色,而非凭文字瞎猜。
- 隐私不变:`V3ChapterOverview` 是 `_V3Strict`,解析期禁 GPS/place;photoDescs 自由文本场景句;`extractedColor` 是纯 hex,无隐私。无 base64 到此端点。

### 2.2 响应(NEW `bookThemeOptions[3]`,替换 `chapterColors`)— ★字体 + 颜色 + 整体风格

```
V3BookThemeOption {                        # NEW:一组主题(★字体 + 颜色 + 整体风格)
  optionId: str        # 稳定标识,用户回选用(如 "warm" / "calm" / "bold" 或 opt-1..3)
  artFont: ArtFontPack # 全书统一字体,4 成员之一
  palette: V3BookThemePalette  # 全书颜色方案(AI 颜色设计;含逐章 accent 或可推导规则)
  style?: str          # 可选:整体风格自由文本(给 Web 展示/区分三组的基调描述)
  label?: str          # 可选:给 Web 展示的一行组名/描述
}

V3RecommendResponse {                       # 改造
  bookThemeOptions: V3BookThemeOption[]    # 固定长度 3（min=max=3,代码补足/截断保证)
  assistantReply: str(≤500)
  usage: V3Usage
}
```

**★颜色恢复**(上一轮误删,本轮改回):每组含 `palette` = AI 用「颜色设计」skill 设计的全书颜色方案。AI 以 §2.1 传入的**逐章提取色 `extractedColor` 为依据**做设计(解决凭文字瞎猜 / 豆包取色丑,同时保留 AI 审美)。模型出的色经 §4 `finalize_color` 归一化为最终 hex(章节 accentColor)。subject(章标题)若仍需推荐,可保留为附带文案。

> recommend 端产出颜色设计(经 finalize_color 定 hex)+ 字体(钳 `artFont` 4 集)+ 补足 3 组。`theme_colors.md` 颜色规则仍用(AI 现额外吃提取色作依据,见 §7)。

### 2.3 grounding 护栏(代码 coerce,镜像 handler.py 现有 `_coerce_*` 风格)

- `bookThemeOptions` 恰好 3 组:模型少出 → 用 fallback 组补;多出 → 截前 3。每组 `optionId` 缺失/重复 → 代码补稳定 id(`opt-1..3`)。
- `artFont` 钳到 `ArtFontPack`(非法/缺失 → `_DEFAULT_FONT`),沿用 `_coerce_font`。
- `style`/`label` 仅做 `str` trim + 长度钳;可空。
- **★颜色钳制保留**:`palette` 内每个色经 §4 `finalize_color` 归一化为合法 hex(沿用/恢复 `_coerce_accent` 的归一化职责);非法/缺失色兜底中性 fallback。若保留 subject,则 `subject` trim + 去句末标点 + 钳 `_MAX_SUBJECT_LEN`(沿用 `_coerce_subject`)。

---

## 3. 章节色归属(★由 Stage4 AI 颜色设计出,以提取色为依据)

决策:**章节最终 accentColor = Stage4 AI 颜色设计 + finalize_color**。AI(「颜色设计」skill)拿 **章节描述 + Stage1 1d 提取色 `extractedColor`** 作依据 → 设计/推荐最终配色,经 `finalize_color` 归一化为合法 hex。Stage1 1d 只产**提取色(依据)**,不产最终色。

1. 用户在 Web 选中 `optionId = X`。
2. 字体:全书统一 = `option[X].artFont`,写进**每个**章节的 `V3Chapter.artFont`(树为章级字段,故逐章写同一值)。
3. 章节 accentColor:取 `option[X].palette` 里该章的设计色 → 经 `finalize_color` 归一化 → 写进 `V3Chapter.accentColor`(Stage1 该字段仍为 null,Stage4 在此填最终值)。
4. subject(章标题)若由本环节出,Web 把它落 title 槽;若不出则沿用现有章标题。

> accentColor 是 **chapter 级属性**(`V3Chapter.accentColor`,schemas.py),由 Stage4 AI 颜色设计 + finalize_color 写入(Stage1 留 null);`extractedColor` 是 Stage1 1d 写的依据字段。封面/无章页的色属 Stage5(同思路:可用提取色作依据 + AI/豆包设计 + finalize_color),本详设不扩 Stage5。

---

## 4. finalize_color(共享)— ★Stage4 恢复调用

- 签名(蓝图 §5):`finalize_color(通用色) -> "#RRGGBB"`;逻辑 boss 待给。
- **★Stage4 调用 finalize_color**:AI 颜色设计出的颜色(`palette` 内各色)经它归一化为最终合法 hex(章节 accentColor)。这是**唯一出最终色口**。
- finalize_color 同时服务**封面色(Stage5)**:封面色是否仍用豆包通用色(经 finalize_color)还是改用 `accent_from_photo` 代码取色 = Stage5 决策,与本环节无关。
- 现 handler.py 的 `_coerce_accent`(通用→hex 归一化)**保留/沿用**:它就是 recommend 端把 AI 出的色归一化的落点(对齐 finalize_color 语义)。

---

## 5. apply-theme(确定性刷字体,改造为「3 组选 1」入参)

### 5.1 入参契约(EXTEND `V3ApplyThemeRequest`)

现状 `V3ApplyThemeRequest.chapters: V3ChapterThemeChoice[]`(每条 `{chapterId, subject, accentColor, artFont}`)。**这个形状对「3 组选 1」已经够用且无需破坏性改动**——选 1 之后,Web 把选中组展开成逐章 `V3ChapterThemeChoice[]`(每章一条:全书统一 artFont、该章 subject;**accentColor 取该章 Stage4 AI 设计经 finalize_color 的最终值**)即可。

- 决策:**复用 `V3ChapterThemeChoice[]` 入参不变**,把「3 组选 1」的展开放在 **Web 编排层**(选 optionId → 全书统一 artFont → 每章 accentColor 取 recommend 响应里该组该章的最终色 → 拼 choices)。Agent 侧 apply-theme **零契约变更**。
- ★accentColor 字段值来自 **Stage4 AI 颜色设计 + finalize_color**(recommend 响应里已是合法 hex)。
- 沿用现有「页不带 chapterId」约束:一次只对一章 apply-theme(单章 choice + 该章页),或单章选择;多章 choice + 页 → 拒(`ApplyThemeV3Error`,见 apply_theme_v3.py)。

### 5.2 刷色行为(沿用 apply_theme_v3.py,不重写)

- `variableDecor` **svg** 槽 → 值即色 = 该章 `accentColor`(★Stage4 AI 设计经 finalize_color 的最终 `#RRGGBB`)。
- `variableDecor` **title** 文字槽 → 仅当为空时填 `subject`(截 `maxChars`);非空(用户手挑章名)保留(#236)。
- `body`/`explain`/普通槽 → 不碰。
- 色/字最终随树章节节点经 carrier 后缀(`THEME_ACCENT_CARRIER_SUFFIX` / `THEME_FONT_CARRIER_SUFFIX`)在 finalize 时烘入扁平页(§3 树边界,渲染契约冻结)。
- **此函数即 Stage5 落地复用的同一套刷色函数**(蓝图 §5 `fill_texts`/`apply_color`;Stage5 复用单页填文案/刷色)——本详设不改其内部,只确认 Stage4/Stage5 共用同一实现。

---

## 6. 模型切换(视觉槽 → DeepSeek)

- 现状:recommend 跑在识图(vision)slot(OpenAI 主 / 火山 failover),见 handler.py `_complete`/`_call_slot`。
- 改动:Stage4 是**纯文字**任务 → 切到 **DeepSeek 槽**(`DEEPSEEK_*`,见 CLAUDE.md 技术栈 / settings)。
  - `_complete` 改用 DeepSeek client(主),failover 策略由实现期定(可保留一个文字模型兜底;**不再**用 vision slot)。
  - `_call_slot` 的 `response_format` / `extra_body` 改用 DeepSeek 对应开关(json mode)。
  - `usage.models` 从 `vision` 改报 DeepSeek 对应字段(`V3Models` 里文案模型槽;若无则按实现期约定登记)。
- 改动面:仅 handler.py 的模型调用层 + prompt 资产改写(全书级 3 组,**prompt 细节不在本详设**)+ schemas.py 响应契约(§2.2)+ `packages/contracts/src/v3.ts` 同步镜像。
- 不变:无状态、不持 draft/stage;隐私在构造上成立(无 base64、无 GPS)。

---

## 7. 契约改动清单(给实现期)

| 文件 | 改动 |
|---|---|
| `apps/agent/src/schemas.py` | NEW `V3BookThemeOption`(optionId/artFont/**palette**/style?/label?);`V3RecommendResponse.chapterColors` → `bookThemeOptions[3]`;`V3RecommendRequest` + `fontHint?`;`V3ChapterOverview` + `extractedColor?`(提取色依据)。★保留/新增 `V3BookThemePalette`(颜色载体)。`V3ApplyThemeRequest`/`Response` **不变**。 |
| `packages/contracts/src/v3.ts` | 同步镜像上面(zod + TS),保持跨语言 parity。 |
| `theme_recommend/handler.py` | `_coerce_response` → 出 3 组(★字体+颜色+风格);模型槽 vision→DeepSeek;★保留 `_coerce_accent` / palette coerce(AI 出色经 finalize_color 归一化)。 |
| recommend prompt 资产 | 改写为全书级 3 组(★字体+颜色+整体风格,AI 用「颜色设计」skill 吃逐章提取色作依据);`prompts/rules/theme_colors.md` 颜色规则保留(补「以提取色为依据」)。 |
| `engine/apply_theme_v3.py` | **不改**(Web 展开 choices;accentColor 取 Stage4 AI 设计经 finalize_color 的最终值)。 |
| Web 编排 | 选 optionId → 全书统一 artFont → 每章 accentColor 取 recommend 响应该组该章最终色 → 拼 `V3ChapterThemeChoice[]` → 逐章 apply-theme;把 artFont + accentColor(+ subject)写树;推进 stage theme→cover。 |

> 改 Web↔Agent 协议(recommend 响应形状)= 须经架构师/契约登记(CLAUDE.md「必须先问架构师」)。
