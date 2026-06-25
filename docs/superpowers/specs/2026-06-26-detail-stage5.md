# Stage 5 详设 — 封面 + 封尾(`/v3/cover` 改造,交互)

- 日期:2026-06-26
- 状态:详细设计(接口 / 契约 / 交互轮 / 复用层级别;不含 prompt / token / 算法)
- 上游蓝图:`docs/superpowers/specs/2026-06-25-agent-system-blueprint.md` §1/§2 Stage5、§0 skills、§5 共享接口
- 高度:**到接口 + 契约 + 交互轮 + 复用函数边界为止**。`finalize_color` / 简易 id 以「共享板块」为准,本文只**引用不重设**;填文案 / 刷色函数与单页编辑、apply-theme **同源复用**,本文只钉边界、不另写。

---

## 0. 决策摘要(本环节范围)

Stage5 把今天「纯确定性塞图 + folio/date」的 `/v3/cover` 升级为
**AI 文案(交互一轮)+ AI 配色 + 代码落地** 三子步,且**落地步把以前分开的「填文案 / 刷色 / 装饰」统一到单页那套复用函数**。

> ★封面色取色方式 = **待 boss 定**:章节色已改为 Stage1 1d 纯代码确定性取色(`accent_of_group`,见 `detail-stage1.md` §1d / `detail-shared.md` §1A)。封面色是否也改用同套代码取色(`accent_from_photo` 看封面照片)替代「豆包出通用色 + finalize_color」= Stage5 单独决策,待定。本文按现有「豆包 + finalize_color」路径描述 5b/5c,若 boss 改走代码取色,5b 换成 `accent_from_photo`、5c 不经 finalize_color。

| 子步 | 谁 | 输入 | 输出 | 归属层 |
|---|---|---|---|---|
| 5a 文案(交互) | DeepSeek | 封面/封尾模板 id + 封面照片(200px,浏览器选)+ hint + userMessage + history + 页槽规格 | coverTexts / endingTexts(可为空)+ assistantReply(可能是反问) | agents(新 `cover_copy`)|
| 5b 配色 | 豆包视觉 | 封面照片(200px,base64) | 通用色(skill 输出,未定 hex) | agents(复用 vision slot)|
| 5c 落地 | 代码 | 5a 文案 + 5b 通用色 + 相关页 | `layoutPatch[]`(文案 + 最终色刷进封面/封尾页) | engine(复用单页填文案 + apply-theme 刷色)|

交互点(蓝图 §1):**5a「问用户填什么」一轮**。5b/5c 不交互。

---

## 1. 与现有 cover_v3 的衔接(保留 / 取代)

现状 `engine/cover_v3.py`(确定性):① `_require_category` 校验模板类目 → ②
`_design_page`(`assign_images_v3` 塞图 + `generic_copy.fill_page_generic_copy`
填 folio/date,用户正文槽留空)→ ③ skip 流程(两 id 都缺 = 空 patch)。

| 现有能力 | Stage5 处置 |
|---|---|
| `_require_category`(模板类目校验,fail-fast) | **保留**,5c 仍先校验 cover/ending 模板合法 |
| `assign_images_v3` 塞图(图装配) | **保留**,封面照片由浏览器选 + Web 落到相关页(见 §5);5c 仍走 `assign_images_v3` 把页上照片塞进模板 image 槽 |
| `generic_copy.fill_page_generic_copy`(folio/date 装饰) | **保留**,5c 仍调它补 folio/date(装饰非用户内容,§3) |
| 「用户正文槽 title/body 留空」 | **被取代** —— 改由 5a AI 写文案 + 5c 复用单页 `_clean_texts` 落进正文槽 |
| 「accentColor 不动 / 留 null」 | **被取代** —— 5b 出色 + `finalize_color` 定 hex + 5c 复用 apply-theme 刷色 |
| skip 流程(两 id 缺 = 空 patch,不报错) | **保留**(见 §4) |
| 「FIRST 页=cover / LAST 页=ending,落不下抛错」 | **保留**(页选取语义不变) |

结论:`cover_v3.py` 从「纯结构变换」升级为「编排 5a/5b/5c」的薄壳;图装配 / 装饰 / 页选取 / skip 全部沿用,新增的是 AI 文案 + AI 配色两次模型调用,落地步换用复用函数。

---

## 2. 接口契约(req / res 变更)

### 2.1 `V3CoverRequest`(EXTEND,`schemas.py` ↔ `packages/contracts/src/v3.ts` 同步)

现有:`albumId / language / coverTemplateId? / endingTemplateId? / pages[]`。

新增字段:

| 字段 | 类型 | 说明 |
|---|---|---|
| `coverPhoto` | `str?`(200px base64) | 浏览器选的封面照片;5a 给 DeepSeek 看 + 5b 给豆包取色。skip 时省略 |
| `endingPhoto` | `str?`(200px base64,可选) | 封尾照片(若封尾也要 AI 取色/看图);无则封尾沿用页上既有照片、配色复用封面通用色 |
| `hint` | `str?` | promptHint(整本基调引导,透传 5a)|
| `userMessage` | `str`(默认 "") | 本轮用户消息(交互输入)|
| `history` | `list[V3ChatTurn]`(`max_length=20`) | 跨轮对话历史(**复用现有 `V3ChatTurn`**,与 chapter-chat/page-edit 同型)|

> `pages[]` 含义不变(Web 服务端再切的相关页,见 §5)。`coverPhoto/endingPhoto` 是
> **Stage5 起新进入 Agent 契约的 base64**(此前 `/v3/cover` 无 base64);隐私按 §3:
> 传入 HTTP body 后丢本地引用、绝不记录、绝不回传。

### 2.2 `V3CoverResponse`(EXTEND)

现有:`layoutPatch[] / assistantReply? / usage`。

| 字段 | 变更 | 说明 |
|---|---|---|
| `layoutPatch` | 不变(`V3LayoutPatchEntry[]`,可空) | 文案 + 色刷进封面/封尾页;skip / 纯反问轮时为空 |
| `assistantReply` | **语义扩展** | 可能是**反问**(5a 问用户填什么)而非确认;Web 据此决定是否结束交互 |
| `needsUserInput` | NEW `bool`(默认 False) | True = 这是反问轮,patch 为空,Web 应展示 reply 等用户答、**不推进 stage** |
| `usage` | 不变 | 计入 vision(5b)+ planning(5a)|

> 蓝图 §2 Stage5 行「coverTexts/endingTexts + assistantReply(可能提问)」即由
> `layoutPatch`(文案已落页)+ `assistantReply` + `needsUserInput` 三者表达;**不**单列
> coverTexts/endingTexts 字段(契约边界仍是页级 patch,与 apply-theme/cover 一致,§3 树边界)。

### 2.3 路由(`routes.py` `POST /v3/cover`)

签名不变;内部从 `cover_v3.build_cover(req)`(同步纯函数)改为
`await cover_v3.build_cover(req)`(**变 async**,内含 5a/5b 模型调用)。错误仍以
`CoverV3Error` → HTTP 错误码;5a/5b 模型失败走**安全兜底**(见 §6),不污染 stage。

---

## 3. 交互轮(5a)

单轮模型(对齐 page-edit 两段式的「轻交互」气质,但 Stage5 只需**一类判断**:文案够不够写):

```
Web 首次进 cover：userMessage="" + history=[] + coverPhoto + 模板 id
  └─ 5a DeepSeek：信息不足 → needsUserInput=True + assistantReply(反问"想在封面写什么标题/副标题?")
                  信息足够 → 直接写 coverTexts/endingTexts，needsUserInput=False
Web 把 reply 显示给用户 → 用户回答 → 再次 POST /v3/cover(userMessage=答案, history+=本轮)
  └─ 5a：据答案写文案 → needsUserInput=False → 5b/5c 落地 → patch 返回
```

- 交互是**无状态多轮**(Agent 不持会话):每轮 Web 带全量 `history`,与 chapter-chat / page-edit 完全一致。
- 「AI 询问用户要填什么」= 5a 在信息不足时返回 `needsUserInput=True` 的那一轮;**至多反问的轮次由 prompt 控制**(本文不写 prompt),代码侧只认 `needsUserInput` 标志。
- `needsUserInput=True` 的轮:**跳过 5b/5c**(不取色、不落地),`layoutPatch=[]`,省 token + 不在用户还没拍板时刷色。
- skip(两模板 id 都缺):**完全不进 5a**,直接空 patch(见 §4)。

---

## 4. skip 流程(保留)

与现状一致并前置:`coverTemplateId` 与 `endingTemplateId` **都缺** → 立即返回
`layoutPatch=[] / needsUserInput=False`,**不调 5a/5b**、不报错(蓝图「跳过=空」)。
只选其一时,另一项不设计页(沿用现有「FIRST=cover / LAST=ending,落不下则跳过该项」语义)。

---

## 5. Web 封面选择 + 边界(§3 数据归属 / 不变式 12)

沿用现有 `apps/web/src/app/api/v3/albums/[uuid]/cover/route.ts` +
`album-service.coverTurn` 的服务端再切模型,**增量**如下:

- 浏览器**只发选择**:`coverTemplateId / endingTemplateId / coverPhotoId / endingPhotoId`
  + NEW **`coverPhoto`(200px base64)/ `endingPhoto?`** + `userMessage` + `history`。
  授权层 `albums.draft_json` 树永不经浏览器往返(不变式 12)。
- Web 服务端:① 从 `draft_json.pages` **再切相关页**(cover=首相关页 / ending=末相关页,
  现有 `withCoverEndingHeroPhotos` + `chapterIdForDraftPage` 逻辑保留);② 把
  `coverPhotoId/endingPhotoId` 换进相关页 hero 槽(现有 `withHeroPhoto`);③ 转发
  `coverPhoto/endingPhoto` base64 给 Agent(**新**:base64 不落盘、不存 draft);④ 收到
  patch 合并进 `draft_json.pages`;⑤ **仅当 `needsUserInput=False` 时**推进 stage
  cover→ready(反问轮不推进,stage 推进权仍在 Web)。
- 200px 封面照片 base64 由浏览器在选图时生成(浏览器是唯一有原图处),随这一轮请求带上。

---

## 6. 落地(5c)与复用函数边界 ★

5c **不另写填文案 / 刷色逻辑**,而是按子步复用三处既有单页函数(单一实现、多处复用,蓝图 §0):

| 5c 子步 | 复用函数(确切边界) | 来源(与谁同源) |
|---|---|---|
| 塞图(图装配) | `engine.skeleton_v3.assign_images_v3` | 与 Stage2 兜底、现 cover_v3 同源 |
| 填装饰(folio/date) | `engine.generic_copy.fill_page_generic_copy` | 与 Stage2 generic、现 cover_v3 同源 |
| **填文案(正文槽)** | `agents.writing.handler._clean_texts(raw_texts, specs, template_id=...)` + `_page_slot_specs(page)` | **与 Stage3 单页编辑(page_edit)同一函数** —— page_edit 段二就调它落 edit_text 补丁;Stage5 把 5a 的 coverTexts 当 `raw_texts` 喂同一清洗/钳裁器 |
| **刷色(强调色 + 字体)** | `engine.apply_theme_v3._apply_page(page, V3ChapterThemeChoice(...))` 的刷色路径(svg variableDecor → accentColor;title 槽逻辑) | **与 Stage4 apply-theme 同一函数** —— 把封面页当「一章」构造一个 `V3ChapterThemeChoice{accentColor=finalize_color(...), artFont, subject=封面标题?}` 喂进去 |
| **定最终色** | `finalize_color(通用色) -> "#RRGGBB"` | **共享板块(Stage4 定义),本文只引用** —— 唯一出最终 hex 的口 |

落地顺序(单页内):`assign_images_v3` → `_clean_texts` 落正文 → `fill_page_generic_copy`
补装饰 → `_apply_page` 刷色,合成一条 `V3LayoutPatchEntry{pageIndex, templateId, images, texts}`。

> 「把以前分开的步骤统一」= 现状 cover_v3 只做「塞图 + 装饰、正文留空、色不动」三步里的两步;
> Stage5 在**同一落地函数内**把「填正文(复用 page_edit 清洗器)+ 刷色(复用 apply-theme)」一并完成,
> 不再分散到下游 story / theme 环节。
>
> 复用要求:`_clean_texts` / `_page_slot_specs` / `_apply_page` 当前是模块私有(`_` 前缀)。
> 实施时应**提升为各自 engine/agents 模块的公开复用入口**(签名不变,仅去私有约束 + 补 docstring),
> 避免跨模块 import 私有符号。这是「复用单页那套函数」的落地动作,**不新写**实现。

---

## 7. 共享板块依赖(只引用,不在本文重设)

- `finalize_color(通用色)->"#RRGGBB"`:共享板块定义;Stage5 在 5c 调用(★若封面色仍走豆包通用色),逻辑 boss 待给。★章节色已不经 finalize_color(Stage1 1d 代码取色);封面色是否改用 `accent_from_photo` 代码取色 = 待 boss 定。
- 简易 id 映射 `to_simple/from_simple`:Stage5 喂 DeepSeek 的载体若需脱敏 id,复用共享映射,**不另建**。
- `V3ChatTurn`:复用现有 schema(chapter-chat / page-edit 同型),不新增交互 turn 类型。

---

## 8. 健壮性 / 无状态 / 隐私

- **无状态**:Agent 不持 draft/stage;5a 多轮靠 Web 回传 `history`;stage 推进权在 Web(反问轮不推进)。
- **安全兜底**(对齐 page-edit `run` 永不崩):5a 解析错 / provider 缺失 / 超时 → 回保守
  `needsUserInput=True` + 默认引导 reply、空 patch、草稿零改动;5b 取色失败 → 退回中性 fallback
  accent(同 recommend 的 `_FALLBACK_ACCENT` 约定)继续 5c,不让配色失败阻断成稿。
- **预算**:整步 `<60s`(同步端点);5a + 5b 至多各一次模型调用(反问轮只 5a)。
- **隐私(§3)**:`coverPhoto/endingPhoto` base64 仅进上游 body 后丢引用、不记录、不入 draft;
  文案绝不写地点(沿用 writing_style grounding 护栏);`location` 槽永留空。

---

## 9. 边界点清单(实施收口)

1. **`finalize_color`**:5c 唯一定最终 hex 处 —— 引用共享板块,不在 Stage5 重写。
2. **复用刷色函数**:`apply_theme_v3._apply_page`(提升为公开)—— 封面页当「一章」构造 `V3ChatThemeChoice` 喂入。
3. **复用填文案函数**:`writing._clean_texts` + `_page_slot_specs`(提升为公开)—— 与 page_edit 段二同源。
4. **Web 封面选择 + 交互**:`cover/route.ts` + `coverTurn` —— 浏览器只发选择 + 200px base64;`needsUserInput` 决定是否推进 stage。
