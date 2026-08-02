# 设计 Agent 挪页工具 move_pages 设计

- 日期: 2026-08-02
- 影响面: `packages/design-agent`(新写工具 + 排版技能更新)、`apps/web`(写工具
  同步点:design-chat 路由 / chat-history 类别映射)、`packages/contracts/skills`
  (相册排版 SKILL.md)、仓根 CLAUDE.md 与 design-agent README(工具清单口径)。
- 现状: 设计 Agent 有六个写工具,都只改单页内容或全书文字主题,没有任何
  改页序的能力;用户在对话里说「把这页挪到前面」只能被拒绝。Web 端已有
  独立的页序入口(2026-08-02 页面顺序调整弹窗 spec + `POST pages/reorder`
  端点),本工具是**对话侧的平行入口**,持久化终点相同(draft_json.pages
  数组),不经过 reorder 端点。

## 已定决策(用户拍板)

| 议题 | 决策 |
|---|---|
| 职责边界 | **单纯挪位置**:页对象原样搬运,不改任何页内容 |
| 调用形态 | **批量操作序列**:一次调用一个 `operations` 数组,逐条 move/swap |
| 锚定页 | 封面/目录/封尾不可挪、不可被平移(与 web reorder 端点口径一致) |
| 双宽页 | 插入语义下就是一条普通记录,无块单位概念(2026-08-02 弹窗 spec 拍板) |

## 一、背景约束(代码事实)

- **页序真相 = pages 数组顺序**。`pageIndex` 是管线遗留字段(按章计数、会
  重复),不能当排序键或寻址键([book-state.ts:94-95](../../packages/design-agent/src/core/album/book-state.ts))。
- **模型面前的寻址是用户口径**:内页 1..M、`cover`/`toc`/`ending` 类别名,
  经 `resolvePageUserRef` 转内部数组位置。新工具复用这层,不发明新寻址。
- **一次成功写入 = 本轮终止**(`commitWrite` 带 `terminate: true`,agent loop
  提前停止)。所以一次调用必须表达完整重排 —— 这是批量形态的直接原因。
- **持久化免费**:committed 时 agent 回传完整 `book.pages`,web 的
  `persistDesignChat` 整数组写回 draft_json。封面钉死意味着数组第 0 位
  永不变化,不触发封面派生物路径。
- 模板没有印刷页码槽、TOC 模板只有标题/装饰/说明槽:挪页不会让已印内容
  变错,不存在连带改文案的隐性需求。

## 二、工具定义

名字 `move_pages`(避开 `swap_` 前缀,防止与 `swap_page_template` 混淆)。

```ts
move_pages({
  operations: [                              // minItems: 1,按序应用
    { type: "move", pageNo: 7, after: 2 },   // before / after 恰好给一个
    { type: "swap", a: 1, b: 4 },
  ],
})
```

- 所有页引用(`pageNo`/`a`/`b`/`before`/`after`)都是用户口径:内页数字或
  类别名。锚点允许类别名:`after: "toc"` = 挪到内容区最前(无目录页时
  `after: "cover"`),`before: "ending"` = 挪到最后。
- `move`:`before`/`after` 必须恰好给一个,都给或都不给是参数错误。

## 三、应用语义

1. **解析**:调用开始时把所有引用一次性解析为**页身份**(对象引用),
   全部锚定调用前的页序。解析失败(未知引用)整个调用拒绝,零写入。
2. **应用**:在身份数组上逐条执行。`move` = 摘出源页,插到锚点页**当前**
   位置的前/后;`swap` = 两页位置互换。引用绑定身份而非序号,前面的操作
   挪动了锚点页也不产生 off-by-one。
3. **提交**:全部操作应用且校验通过后一次 `commitWrite`(version+1、
   updatedAt、terminate),失败则原书状态不动。

## 四、校验红线

- 源页(`move.pageNo`、`swap.a`/`swap.b`)必须是内页;封面/目录/封尾作源
  直接拒绝。
- 应用完成后,**任何非内页记录的数组下标都不许变**(防御性通则,与 web
  reorder 端点一致;哪怕锚定页因数据漂移出现在书中间也不会被平移殃及)。
- `swap` 两页不得相同;`move` 锚点不得是源页自身。
- 净效果为恒等置换(挪了又挪回去)→ 拒绝,不空耗版本号。
- 净效果构造上必然是同一批页对象的排列:增页/删页/改内容在结构上不可能,
  这就是「单纯挪位置」的保证(测试再显式断言一遍)。

## 五、工具结果

- `details.operations`:用户口径的每步描述(历史气泡「更新了什么」彩色条
  的数据源),`details.pageNo` 按既有契约填第一个源页。
- `notes`:挪动过的页的新旧页码映射(「原第 7 页 → 现第 3 页」),模型在
  同轮回复里不说错页码。内页用户编号在挪动后整体重排,这是唯一让模型
  可能犯糊涂的点,必须在结果里喂给它。

## 六、同步义务(新写工具的接线清单,一个不能漏)

| 位置 | 动作 |
|---|---|
| `design-chat/route.ts` `DESIGN_WRITE_TOOLS` | 加 `move_pages`(否则该轮 ops 不落库,历史气泡丢「已更新」条) |
| `chat-history.ts` 写工具→类别映射 | 新「页序」类别 |
| `packages/contracts/skills/album-layout/SKILL.md` | 相册排版技能补挪页规则(只动内页、一次调用表达全部重排、挪页不改内容) |
| `core/album/skills.ts` 内置兜底 | 同步同一段规则(守卫测试盯名字集合,内容靠本条自觉) |
| 仓根 CLAUDE.md | 「六个写工具」改七个并列出新名字 |
| design-agent README | 工具清单更新;doc-scope 覆盖 `src/**`,提交时推进 checked-at |

## 七、测试

- 行为:挪中间页到前/后锚点、`after:"toc"` 挪最前、`before:"ending"` 挪最后、
  swap 相邻/远距、多步复合(含锚点页自己先被挪过的身份锚定证明)。
- 拒绝:非内页源、锚定页被平移(如 `before:"cover"`)、`a === b`、锚点=源、
  恒等净效果、未知引用、`before`/`after` 同给或都不给、空 operations。
- 不变量:同对象集合(排列)、每页 texts/images/html/pageIndex 逐字段不变、
  version 恰 +1;挪后每页仍过 contracts `Page` strict 契约(parity 套路)。
- web 侧:`DESIGN_WRITE_TOOLS` 含 `move_pages`;chat-history 类别映射覆盖
  全部写工具。

## 八、非目标

- 不做增页/删页/复制页;不做章节结构调整。
- 不自动改任何文字(没有页码槽,无此需求;真有用户要改文案走既有工具)。
- 不动 web 的 reorder 端点与页序弹窗(平行入口,各走各的写路径)。
- 不做「挪页后自动换模板保持节奏」之类的聪明行为 —— 模型想做可以在
  下一轮用既有工具做,且要先征得用户同意。
