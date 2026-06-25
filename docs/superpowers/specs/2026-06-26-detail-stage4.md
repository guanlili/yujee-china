# Stage 4 设计(主题:字体 + 整体风格)— 详设

- 日期:2026-06-26
- 状态:详设 v2(★已并入「章节色移出 Stage4」决策:Stage4 只出字体 + 整体风格,不出任何颜色)
- 上游蓝图:`2026-06-25-agent-system-blueprint.md` §1/§2 Stage4、§0 skills、§5 共享组件、§6-2
- 真相源(章节色决策):`2026-06-26-detail-stage1.md` §1d「章节取色」—— 章节 accentColor = Stage1 1d 纯代码确定性取色(参考 accent_color.py),Stage4 **不碰章节色**。
- 接地代码:
  - `apps/agent/src/agents/theme_recommend/handler.py`(recommend 现状:逐章 subject+色+字)
  - `apps/agent/src/agents/theme_recommend/recommend_theme.md`(prompt 资产,本详设不改 prompt;★`prompts/rules/theme_colors.md` 颜色规则随章节色移出而弃用)
  - `apps/agent/src/engine/apply_theme_v3.py`(确定性刷字体;章节 accentColor 已由 Stage1 定,apply 仍可落页但不在本环节产生)
  - `apps/agent/src/schemas.py`(契约真相源,§ enums / v3.ts recommend / apply-theme / theme carriers)
- 高度:**只到接口 / 契约 / 刷字体层**。prompt 文案、token、failover 实现细节不在此。

> 共享件「简易 id 映射」(蓝图 §0,代码)以**共享板块**为准,本详设**只引用、不重设**。`finalize_color()` 对**章节色不再需要**(章节色 = Stage1 1d 代码取色,已是合法 hex);finalize_color 仅可能服务封面色(Stage5 待定),本环节不调用。

---

## 0. 范围与已定决策(回顾)

- DeepSeek 出**整体 3 组(字体 + 整体风格),全书级**,非每章 → 用户选 1。**★只出字体 + 整体风格,不出任何颜色**(accentColor / palette / 通用色全移除)。
- **章节 accentColor 不归本环节**:章节色 = Stage1 1d 纯代码确定性取色(真相源 = `detail-stage1.md` §1d),Stage4 **不碰章节色**;accentColor 仍是 **chapter 级属性**,但在 Stage1 即已写定。
- **本环节不调 `finalize_color()`**:章节色已是确定性 hex,不需归一化;finalize_color 仅可能服务封面色(Stage5 待定)。
- `apply-theme`(确定性刷)把选中字体刷进 pages;章节 accentColor 在 apply 时仍可随树落页,但**不来自本环节**(它来自 Stage1 1d)。适配「3 组选 1」新入参(§5)。
- 模型从视觉槽切到 **DeepSeek**(纯文字任务,§6)。
- 字体沿用固定 4 字体列表(`ArtFontPack`)+ hint。

---

## 1. Stage4 子流程(全书级 3 组 → 选 1 → 刷字体)

```
[A] recommend(DeepSeek,改造)   全书概览(章节 overview + analysisSummary + fontHint?)
      → bookThemeOptions:{optionId, artFont, style(整体风格)}[3]   ★只字体+风格,无任何颜色
      → assistantReply
   ▼ 用户在 Web 选 1（交互点,Web）
[C] apply-theme（代码,改造）     选中字体 → layoutPatch[]
                                 artFont 落 chapter（树）、subject 落 title 槽（页)
                                 ★章节 accentColor 由 Stage1 1d 已定;apply 仍可把已定 accentColor 落页,但不在本环节产生
   ▼ Web 合并 + 推进 stage theme→cover
```

边界:**[A] 出意图(字体+风格)、[C] 保合法、Web 提交并推进 stage**(沿用现状:recommend 不推进 stage,见 handler.py 顶注)。★无 finalize_color 步(章节色非本环节产物)。

---

## 2. recommend 请求 / 响应(改造)— 全书级 3 组

### 2.1 请求(EXTEND `V3RecommendRequest`)

复用现有 `V3RecommendRequest` 主体,只加一个可选 `fontHint`:

```
V3RecommendRequest {
  albumId: str
  language: V3Language
  chapters: V3ChapterOverview[]    # REUSE:每章 {chapterId, description, photoDescs[]}
  analysisSummary?: str(≤1000)     # REUSE
  userMessage?: str(≤500)          # REUSE(用户引导,例如 "想要暖一点")
  fontHint?: str(≤200)             # NEW(蓝图 §2 表):字体倾向自由文本,非强约束
}
```

- `chapters` 仍是全书章节概览 → 模型据此做**全书级**判断(每组给一套字体 + 一种整体风格),不再「按章各推一条」,**且不出任何颜色**。
- 隐私不变:`V3ChapterOverview` 是 `_V3Strict`,解析期禁 GPS/place;photoDescs 自由文本场景句。无 base64 到此端点。

### 2.2 响应(NEW `bookThemeOptions[3]`,替换 `chapterColors`)— ★只字体 + 整体风格,无颜色

```
V3BookThemeOption {                        # NEW:一组主题(★字体 + 整体风格,无任何颜色)
  optionId: str        # 稳定标识,用户回选用(如 "warm" / "calm" / "bold" 或 opt-1..3)
  artFont: ArtFontPack # 全书统一字体,4 成员之一
  style?: str          # 可选:整体风格自由文本(给 Web 展示/区分三组的基调描述)
  label?: str          # 可选:给 Web 展示的一行组名/描述
}

V3RecommendResponse {                       # 改造
  bookThemeOptions: V3BookThemeOption[]    # 固定长度 3（min=max=3,代码补足/截断保证)
  assistantReply: str(≤500)
  usage: V3Usage
}
```

**★为什么不再有 palette / perChapter / 任何颜色**:章节色已移出 Stage4 —— 章节 accentColor = Stage1 1d 纯代码确定性取色(真相源 = `detail-stage1.md` §1d)。模型不再产 accentColor / base / 逐章色;`V3BookThemePalette`、`perChapter[].accent` 等颜色载体**整体删除**。subject(章标题)若仍需推荐,可保留为字体组的附带文案,但**不再绑定任何颜色**(若 subject 不再由本环节出,可一并删,见 §3)。

> recommend 端**不**产出/钳制任何颜色;只钳 `artFont`(4 集)、补足 3 组。`theme_colors.md` 颜色规则随章节色移出而弃用(见 §7)。

### 2.3 grounding 护栏(代码 coerce,镜像 handler.py 现有 `_coerce_*` 风格)

- `bookThemeOptions` 恰好 3 组:模型少出 → 用 fallback 组补;多出 → 截前 3。每组 `optionId` 缺失/重复 → 代码补稳定 id(`opt-1..3`)。
- `artFont` 钳到 `ArtFontPack`(非法/缺失 → `_DEFAULT_FONT`),沿用 `_coerce_font`。
- `style`/`label` 仅做 `str` trim + 长度钳;可空。
- **★无任何颜色钳制**:`_coerce_accent` / palette / perChapter 那套 coerce 整体删除(章节色非本环节产物)。若仍保留 subject,则 `subject` trim + 去句末标点 + 钳 `_MAX_SUBJECT_LEN`(沿用 `_coerce_subject`);若 subject 也不再由本环节出,则一并删。

---

## 3. 章节色归属(★已移出 Stage4)

决策:**章节 accentColor = Stage1 1d 纯代码确定性取色**(真相源 = `detail-stage1.md` §1d:整章聚合、丢天空/白墙/黑/灰、饱和度加权取主色相、用设计固定 L/S 重建)。**Stage4 不碰章节色,不做任何色映射**。

1. 用户在 Web 选中 `optionId = X`。
2. 字体:全书统一 = `option[X].artFont`,写进**每个**章节的 `V3Chapter.artFont`(树为章级字段,故逐章写同一值)。
3. 章节 accentColor 在 Stage1 已写定(`V3Chapter.accentColor`,合法 hex),Stage4 **不重算、不覆盖**;apply-theme 刷字体时该 accentColor 仍随树落页(见 §5),但**值来自 Stage1**。
4. subject(章标题)若由本环节出,Web 把它落 title 槽;若不出则沿用现有章标题。

> accentColor 是 **chapter 级属性**(`V3Chapter.accentColor`,schemas.py),由 Stage1 1d 写入;Stage4 只写 `artFont`。封面/无章页的色属 Stage5(封面色是否改用 `accent_color` 代码取色 = Stage5 待定),本详设不扩 Stage5。

---

## 4. finalize_color(共享)— ★Stage4 不再使用

- 签名(蓝图 §5):`finalize_color(通用色) -> "#RRGGBB"`;逻辑 boss 待给。
- **★Stage4 不调用 finalize_color**:章节色 = Stage1 1d 代码取色(已是合法 hex,无需归一化);本环节不产出任何颜色,故无最终色要过。
- finalize_color 的去留取决于**封面色(Stage5)**:封面色是否仍用豆包通用色(经 finalize_color)还是改用同套 `accent_color` 代码取色(`accent_from_photo`)= **Stage5 单独决策,待定**。在那之前 finalize_color 标为「仅可能服务封面色」。
- 现 handler.py 的 `_coerce_accent`(通用→hex 归一化)随章节色移出而**弃用/删除**(recommend 端不再产色,无色可钳)。

---

## 5. apply-theme(确定性刷字体,改造为「3 组选 1」入参)

### 5.1 入参契约(EXTEND `V3ApplyThemeRequest`)

现状 `V3ApplyThemeRequest.chapters: V3ChapterThemeChoice[]`(每条 `{chapterId, subject, accentColor, artFont}`)。**这个形状对「3 组选 1」已经够用且无需破坏性改动**——选 1 之后,Web 把选中组展开成逐章 `V3ChapterThemeChoice[]`(每章一条:全书统一 artFont、该章 subject;**accentColor 取该章 Stage1 1d 已定值**,不在本环节重算)即可。

- 决策:**复用 `V3ChapterThemeChoice[]` 入参不变**,把「3 组选 1」的展开放在 **Web 编排层**(选 optionId → 全书统一 artFont → 每章 accentColor 直接取树上 Stage1 已定值 → 拼 choices)。Agent 侧 apply-theme **零契约变更**。
- ★accentColor 字段仍在入参,但其值来自 **Stage1 1d**(树上已定),本环节不产生它、不经 finalize_color。
- 沿用现有「页不带 chapterId」约束:一次只对一章 apply-theme(单章 choice + 该章页),或单章选择;多章 choice + 页 → 拒(`ApplyThemeV3Error`,见 apply_theme_v3.py)。

### 5.2 刷色行为(沿用 apply_theme_v3.py,不重写)

- `variableDecor` **svg** 槽 → 值即色 = 该章 `accentColor`(★Stage1 1d 已定的 `#RRGGBB`,非本环节产出)。
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
| `apps/agent/src/schemas.py` | NEW `V3BookThemeOption`(★只 optionId/artFont/style?/label?,无颜色);`V3RecommendResponse.chapterColors` → `bookThemeOptions[3]`;`V3RecommendRequest` + `fontHint?`。★**不**新增 `V3BookThemePalette`(无颜色载体)。`V3ApplyThemeRequest`/`Response` **不变**。 |
| `packages/contracts/src/v3.ts` | 同步镜像上面(zod + TS),保持跨语言 parity。 |
| `theme_recommend/handler.py` | `_coerce_response` → 出 3 组(★只字体+风格);模型槽 vision→DeepSeek;★删 `_coerce_accent` / palette / perChapter 那套颜色 coerce(章节色非本环节产物)。 |
| recommend prompt 资产 | 改写为全书级 3 组(★只字体+整体风格,不出颜色);`prompts/rules/theme_colors.md` 颜色规则弃用。 |
| `engine/apply_theme_v3.py` | **不改**(Web 展开 choices;accentColor 取 Stage1 已定值)。 |
| Web 编排 | 选 optionId → 全书统一 artFont → 每章 accentColor 取树上 Stage1 1d 已定值 → 拼 `V3ChapterThemeChoice[]` → 逐章 apply-theme;只把 artFont(+ subject)写树,accentColor 已由 Stage1 写定;推进 stage theme→cover。 |

> 改 Web↔Agent 协议(recommend 响应形状)= 须经架构师/契约登记(CLAUDE.md「必须先问架构师」)。
</content>
</invoke>
