# 封面封尾工具(设计 Agent)— 设计说明

需求(用户拍板,2026-07-21):设计 Agent 能**增加**和**修改**封面/封尾,含**整体配色**;并能**唤起封面选择卡**让用户挑组。分工:两条路都要 —— Agent 可直接改,也可调卡让用户点选;重选**只换封面封尾两页**,不重跑全书字体/配色;书里缺封面/封尾时能补页。

## 现状锚点
- 现有 10 工具的 `pageNo` 已支持 `"cover"/"ending"` 口径(book-state.ts `PageUserRef`);改封面文字/颜色/模板底层本就可行,此前是产品层 defer(ChatPanel 注释「封面、整体设计两类用户明确 defer」)。
- 无增删页能力;页真相 = HTML(`bakeAlbumPageHtml`/`renderPageHtml`)。
- 封面选择卡(coverDock,ChatPanel `offerDesignCard`)只在首次设计弹;数据 `GET /api/v3/albums/{uuid}/design`(规则组,零 AI),选定 `POST /design` 走 engine 出字体/颜色/文案并全书套用。
- 每回合 design-chat 前 `prepareDesignChat` 把最新 draft 推给 8787,web 侧改动下一回合自动同步,无旧状态坑。

## 新工具(design-agent tools.ts,一工具一职责)

### 1 `add_cover_page` — 缺页补页
- 参数:`{ kind: "cover"|"ending", templateId, photoId, texts? }`
- 已有该类页 → 拒绝并提示用修改类工具。`templateId` 必须属对应类目(模板目录校验);`photoId` 必须是书中真实照片(短 id,不碰 UUID)。
- 烘 HTML 后插入:封面最前、封尾最后;插入后 `pageIndex` 顺序重编。`texts` 可选,不传留模板默认。

### 2 `set_cover_palette` — 整体配色一次成套
- 参数:`{ pageNo: "cover"|"ending", background, textColors: {slotId: color…} }`
- 一次调用把背景(页根/carrier)+ 各文字槽颜色协调落到该页 HTML;文字色锚点机制复用 `set_text_colors`;产物过 html-guard。
- 工具描述要求 AI 成套传入(背景+标题+副标一次给齐),不鼓励逐项碎改。

### 3 `offer_cover_picker` — 唤起选择卡
- 无参(或可选提示语)。**零副作用**,返回「选择卡已唤起,请用户点选」。
- ChatPanel 在 NDJSON 流截获 `tool_call: offer_cover_picker` → 回合结束弹**重选版**封面卡。

## repick 语义(重选只换两页)
- `GET /design` **不改**:sets 规则生成,与 designed 无关;重选卡忽略 `designed` 标志。
- `POST /design` 加 `repick: true`:跳过 engine 字体/颜色/文案调用,只烘换选中组的封面+封尾两页(缺则插入);现有封面文字按槽位 id 迁移保留;内页一律不动。

## 前端联动(ChatPanel / design-chat route)
- 重选卡复用 `cv-pick-card`,差异三点:不锁输入、可关闭、点选后 `POST /design {repick:true}` → 重绘两页。
- 播报:`DESIGN_CHANGE_CATEGORY` + `DESIGN_WRITE_TOOLS` 加 `add_cover_page`/`set_cover_palette` → 新类别 `cover`(标签「封面」)。`offer_cover_picker` 非写工具,不进历史。

## 测试
- design-agent:三工具单测(test/*.test.ts 现有模式):补页位置/拒绝重复/类目校验;配色落 HTML+guard;picker 零副作用。
- web:design-apply repick 分支单测(只动两页、文字迁移);ChatPanel 字符串断言补重选卡与 cover 类别。

## 影响面
design-agent(tools.ts/system-prompt.ts)+ web(design route、album-service/design-apply、ChatPanel、design-chat route)。不碰 engine、契约、DB。部署:Web(Vercel)+ design-agent(Fly)两端。
