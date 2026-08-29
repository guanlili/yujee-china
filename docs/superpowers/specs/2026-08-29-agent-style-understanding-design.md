# 设计 Agent「风格理解」设计稿

日期：2026-08-29 · 状态：待评审

## 一句话

给设计 Agent 一个「风格」概念层：一个教它把用户的模糊不满翻译成风格判断的 skill（脑），
外加四个能真正落地风格的工具（手）。用户说「太素了」「不够活泼」时，Agent 先理解这是
风格级诉求，再动手换风格，而不是随手换一个单页模板。

## 为什么现在不行

1. **Agent 没有「风格」这个概念。** 它有 `set_text_colors`（只刷文字）、`set_text_fonts`、
   `swap_page_template`（只换单页版式）。没有任何工具能表达「把这本书换成另一种气质」。
2. **Agent 不知道这本书当前是什么风格。** 书级简报（`album-server.ts` 的
   `composeChatTurn`，拼在每轮用户消息前缀里）只有 theme/palette/coverMood。
   不知道现状，就谈不上「理解并调整」。
3. **Agent 完全没有页面背景色工具。** 页底色只有成书时 `applyDesign` 写一次，之后
   Agent 碰不到。用户说「这页底色换成蓝的」做不到。
4. **现有 prompt 有条规则会绕过风格判断。** `system-prompt.ts:29`：「模糊的审美反馈
   （"换个感觉"）不要追问，直接动手换模板」。风格级不满会被它导向随机换单页模板。
5. **已知未修的坑。** `design-apply.ts:249-256` 注释点名：Agent 能把浅底书的封面换成
   mag-62，文字 carrier 仍是 `#1c1b18` 落在 `#12363A` 上，约 1.3:1，读不了。

## 一个前提修正：四套封面原本不构成四个风格

选封面卡的四套是 `mag-01 / mag-23 / mag-62 / p01`（`design-apply.ts` 的 `SET_LAYOUT`），
配的页底色是 `PAGE_BACKGROUNDS` 的 `#FFFFFF / #FBF8F1 / #F1F2F0 / #ECEDEE` —— 四个白，
肉眼分不出；字体不随套变（compose 统一派）。也就是说**只有第三套（mag-62 + 彩色）
是真风格，另外三套的差别只有封面版式一张图**。

照搬映射成四个 Agent 风格，用户说「换成风格 2」时全书几乎不变，是个空功能。
所以本设计给另外三套各自补上真配色（底色拉开成暖白 / 冷灰 / 暖砂）。

用户已确认这一版（2026-08-29，配色稿见 `~/Desktop/Agent四风格配色稿.html`）。

## 四个风格

| id | 名字 | 封面 / 封底 | 页底 | 标题 | 正文 | 注释 |
|---|---|---|---|---|---|---|
| `editorial` | 素白散文 | mag-01 / mag-22 | `#FBF8F1` | `#1C1B18` | `#2E2C27` | `#6B6760` |
| `magazine` | 杂志刊头 | mag-23 / mag-22 | `#E7EAE9` | `#0F0F0F` | `#2B2E2C` | `#6E7370` |
| `dopamine` | 多巴胺 | mag-62 / mag-63 | 五色随机 | 两色字自动配 | 同 | 同 |
| `postcard` | 旅行画报 | p01 / mag-22 | `#F1E7D5` | `#1C1B18` | `#3A362E` | `#A8502E` |

多巴胺沿用现成的第三套：内页五色 `#F3F0A8 / #9F82E8 / #C83E18 / #107E47 / #2D6DB0`，
封面三色 `butter / blue / red`，字色走 `THIRD_SET_INK` 两色规则（深底浅字、浅底深字）。
每页取色仍走 `interiorInkSequence(albumId, count)` 那条确定性序列 —— 前缀稳定是追加照片
不串色的结构性保证，不能换成随机。

**所有色值都要过 4.5:1 对比度实测**，与 `third-set-palette.test.ts` 同一套算法。
`postcard` 的注释色 `#A8502E` 是把模板自带的 `#d27b62`（在 `#F1E7D5` 上约 2.9:1，不达标）
压深来的，不是拍脑袋定的。

## 架构

### 1. 真相源搬进 contracts

现在 `third-set-palette.ts` 在 `apps/web/src/lib/design/`，design-agent 是独立包够不着。
搬进 `packages/contracts/src/design-styles.ts`，apps/web 留一个 re-export 薄壳：

```ts
// apps/web/src/lib/design/third-set-palette.ts
export * from '@yujee/contracts/design';
```

导入路径和现有测试（`design-apply.test.ts`、`compose-completed.test.ts`、
`job-service-append.test.ts`、`cover-recap.test.ts`）都不用改，也不产生第二份色表。
`page-backgrounds.ts` 同样搬过去 —— 风格的调色板要引用那四个白。

### 2. 当前风格从封面模板反推，不加字段

```ts
export function bookStyleOf(coverTemplateId: string): BookStyle  // mag-62 → dopamine
```

零迁移、老书自动就有风格。用户单独换过封面模板时风格跟着变 —— 这是对的，封面就是风格的脸。
反推不到（换了张表外的封面）时回落 `editorial`，并在工具返回值里说明。

### 3. 页底色要挺过重烘（技术关键）

`set_text_colors` / `swap_page_template` 都是 `page.html = undefined` 再
`bakeAlbumPageHtml(page)` 从模板重烘 —— 现在 `applyDesign` 写的 inline 背景色会丢。

方案：新增 carrier 键 `texts['#pageBackground']`，与 `#accentColor` / `#artFont` 同一套
magic key 文法（`theme-carrier.ts`），烘制时由 `renderPageHtml` 写进页根 style。

**必须追加在 style 末尾**：模板根节点写的是 `background:#fff` 简写，前置会被它盖掉。
web 的 `upsertStyleAttr` 用 Map 保序、新 key 天然落到末尾，所以现有 inline 路径是对的；
新的烘制路径要显式保证同样的顺序。（本设计过程中已实测踩中过这个。）

无该 carrier 键时 `renderPageHtml` 输出**逐字节不变** —— 这条要有测试钉死，
因为 `fill-template.ts` 是 engine 和 web 共用的。

web 侧 `applyDesign` 改为同时写 carrier 和 inline，老路行为不变。

## 四个工具

### `apply_book_style(styleId)`
整本刷：换封面/封底模板 + 全书页底色 + 三色文字。多巴胺走 `interiorInkSequence`。
返回：改了几页、封面文案迁移结果、新风格的中文名。

**代价（要在返回值里报告，且 skill 要求换前先告知用户）**：换封面模板走
`swap_page_template` 的槽迁移规则，**迁不过去的封面文案会丢**。

### `set_page_background(pages, colorId)`
单页 / 全书改页底色。`pages` 用现有 `PageUserRef` 口径（内页数字、`"cover"`/`"toc"`/`"ending"`、
双宽页 `"5-6"`、`"all"`）。

`colorId` 只能从**当前风格的调色板**里挑，传了表外的值就打回并列出可选值 ——
这是「限定在五色内，Agent 可指定」的落地（用户拍板 2026-08-29）：

- 多巴胺：`THIRD_SET_INTERIOR` 的五个色 id（`butter/violet/orange/green/blue`）。
- 其余三个风格：该风格主底色 + `PAGE_BACKGROUNDS` 四个白系（`white/ivory/mist/ash`）。

改哪一页的底色，那一页的文字色就按 `THIRD_SET_INK` 两色规则跟着翻（深底浅字、浅底深字），
不留「改完底色字读不了」的中间态。

### `set_text_colors`（改造）
加对比度硬校验：新文字色落在该页当前底色上 < 4.5:1 直接打回，报告是哪几页、实测多少。
现在这个工具能把字刷成任意色，深底书上刷个深字就整页读不了。

### `swap_page_template`（改造）
换到深底模板（mag-62 / mag-63 / p01）时自动翻转 carrier 文字色为 `THIRD_SET_INK.light`，
换回浅底模板时翻回 `.dark`。这修的就是 `design-apply.ts:249` 点名至今没修的 1.3:1。

## Skill：风格理解（核心）

`packages/contracts/skills/album-style/SKILL.md`。**这是本次改动的中心** ——
工具是手，skill 是脑。用户对整本观感不满时的入口。

### 触发
用户对**整本**的观感表达不满或诉求：「太素了」「太花了」「不够活泼」「换个感觉」
「这本书不好看」「想文艺一点」，或直接点名风格（「多巴胺」「像杂志那种」）。

### 形容词 → 风格映射（skill 的实体）

| 用户可能说 | 指向 |
|---|---|
| 太素 / 太白 / 太空 / 不够活泼 / 太单调 | 多巴胺 |
| 太花 / 太吵 / 太跳 / 太闹 / 颜色太多 | 素白散文 或 杂志刊头 |
| 文艺 / 安静 / 书卷气 / 像散文集 / 想留白 | 素白散文 |
| 高级 / 干净利落 / 像杂志 / 有设计感 / 硬朗 | 杂志刊头 |
| 温暖 / 旅行感 / 复古 / 胶片 / 有故事感 | 旅行画报 |
| 年轻 / 有活力 / 鲜艳 / 多巴胺 / 想跳一点 | 多巴胺 |

### 判断流程
1. 先看当前风格（书级简报里有，或从封面反推）—— 不知道现状就无从调整。
2. 把用户的形容词落到映射表上；当前风格已经是目标风格时，不要空转换一遍，
   改走局部调整（换个底色 / 只调文字色）。
3. 定作用范围：
   - 整本气质不对 → `apply_book_style`
   - 只有某几页颜色不对 → `set_page_background`
   - 只有字的颜色不对 → `set_text_colors`
4. 换风格前一句话告知代价（封面文案会重排），改完请用户看效果。

### 反例（写进 skill）
- 用户说「这页颜色不好看」→ 调这一页，**不要整本换风格**。
- 用户说「这页版面太乱」→ 换单页模板，走排版技能，不是风格问题。
- 不要为了「用满四个风格」硬推荐；当前风格合适就说合适。

### 配套改动
- `album-color/SKILL.md` 补一句：颜色从当前风格的调色板里挑，别自由发挥 hex。
- `system-prompt.ts:29` 那条「模糊的审美反馈直接动手换模板」加分流：
  **书级 / 风格级的不满先走风格理解技能；单页版面的不满保持现在的直接动手。**
  不改这条，风格 skill 会被它绕过去。
- 书级简报加一行当前风格的中文名。落点是 `album-server.ts` 的 `composeChatTurn`
  （拼在每轮用户消息前缀里），**不是 system prompt** —— 它每轮从 `runtime.getBook()`
  现取，Agent 换完风格后下一轮看到的就是新风格。需要给它多传一个封面 templateId
  或整个 book 用于反推。

## 测试

- 四风格全部色值对比度 ≥ 4.5:1（复用 `third-set-palette.test.ts` 的算法）。
- `renderPageHtml` 无 `#pageBackground` carrier 时输出逐字节不变（护 engine/web 共用路径）。
- `#pageBackground` 写进页根 style **末尾**，能盖住模板的 `background:#fff` 简写。
- 搬家后 `THIRD_SET_INTERIOR` / `LEGACY_*` / `interiorInkSequence` 逐项不变（老书不串色）。
- `bookStyleOf` 四个封面 id 各自反推正确；表外 id 回落 editorial。
- `composeChatTurn` 在书有封面时带出当前风格名；换风格后下一轮带的是新风格。
- `set_text_colors` 在深底页上刷深字被打回。
- `swap_page_template` 换到 mag-62 后字色翻成 light（当前 1.3:1 的回归测试）。
- `set_page_background` 传表外 colorId 被打回且列出可选值。
- 接线测试断言前先剥注释（见记忆：源码正则会被注释喂饱），写完跑一次 mutation 验证守卫真的会红。

## 不做

- 不给风格加字体维度：字体是 compose AI 按内容派的，风格强刷会打架。用户点名换字体时
  仍走 `set_text_fonts`。
- 不动选封面卡的交互：卡片还是四张预览图，用户选封面的路径一个字不改。
- 不让 Agent 自由填任意 hex 作页底色（超四色色域印不出、对比度失守）。
