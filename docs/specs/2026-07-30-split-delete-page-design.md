# 设计 Agent 拆页 / 删页工具设计

> **⚠️ 未定稿，不要据此实施。**
> 2026-07-30 查明 engine 选版完全不认识双宽模板（`spread` 字段在
> `engine/src/workflows/core/layout/` 里零引用，6 个双宽模板混在普通模板池里被随机
> 抽中），书在 AI 编辑之前就可能带着半白页。本文「为什么拆页只能拆成奇数页」与
> 「拆成几页」两处规则是建立在那个坏地基上的补丁，**待 engine 分页改为按跨页为单位
> 之后重写**（见 `2026-07-30-engine-spread-pagination-design.md`）。
> 其余部分（工具契约、图片守恒、配色继承、轮次预算、接线、测试）不受影响。

- 日期: 2026-07-30
- 影响面: `packages/design-agent`、`apps/web`（接线两处）
- 依赖: engine 分页按跨页为单位（先做）
- 现状: 设计 Agent 有 6 个写工具，全部作用于**已存在的页**；书的页数是 engine
  `/v3/select-layout` 一次定死的，对话阶段无法增减。

## 目标

让设计 Agent 能在对话中改变书的页数，覆盖两个用户意图：

1. **拆页（主线）**：AI 排版把过多照片挤在一页，用户要求摊开成多页大图。
2. **删页**：这页不要了，连图带文一起移除。

## 已定决策

| 议题 | 决策 |
|---|---|
| 拆页做成组合工具还是原子工具 | **组合**。`split_page` 一次调用完成建页 + 分图 + 继承样式 |
| 版式由谁选 | **AI 选**。先 `list_templates` 看候选，把模板 id 列表传进 `split_page` |
| 每页放几张图 | **不传**。等于模板图槽数，代码推导 —— 图槽必须填满，没有自由度 |
| 图片守恒 | 拆页前后图片总数**必须相等**，不多不少 |
| 拆成几页 | **只允许奇数**（1→3 / 5 / 7）。净增偶数页，后面的跨页不移位 |
| 删页时页上的照片 | **随页移除**，不回流到其他页 |
| 封面 / 目录 / 封尾 | **不可拆、不可删** |
| `pageIndex` | 插删后全书重排为 0..n-1 连续 |
| 前端刷新 | **不用改**。`replacePages` 已是整体替换，页数变化天然支持 |

## 为什么拆页只能拆成奇数页

`placePages`（[apps/web/src/components/album/page-layout.ts:27](../../apps/web/src/components/album/page-layout.ts)）
是左右页配对的唯一真相：内页顺序两两配成 left/right，`cover`/`ending`/双宽模板
独占一格并重置配对。

因此**决定后面的页翻不翻面的是净增页数的奇偶，不是拆成几页**：

- 拆成 2 页 = 净增 1（奇）→ 后面所有内页左右互换，直到下一个 solo/双宽页吸收
- 拆成 3 页 = 净增 2（偶）→ 后面纹丝不动

相册是装订成册的实物，「只改了一页，后面全翻面」对用户是不可接受的意外。故限制
拆出页数为奇数。

代价：**2 张图的页拆不了**（守恒要求 3 个模板的图槽和为 2，而零图槽内页只有
`mag-10` 一个，凑出来是一张突兀的纯文字页）。用户的痛点场景是 6 图、9 图的密集页，
奇数选择充裕，接受这个代价。

真实模板存量（`packages/contracts/templates`，47 个）：

| 类目 | 数量 | 图槽数 |
|---|---|---|
| interior | 40 | 0 / 1 / 2 / 3 / 4 / 5 / 6 / 9 |
| cover | 4 | 1 |
| ending | 2 | 1 / 2 |
| toc | 1 | 0 |

单图 interior 模板 21 个，拆大图不缺版式。

## 工具契约

### `split_page(pageNo, templateIds)`

- `pageNo` — 用户口径页码。**只接受内页**，传 `"cover"`/`"toc"`/`"ending"` 直接拒绝。
- `templateIds` — 模板 id 数组，AI 先用 `list_templates` 挑好。例：`["mag-18","mag-03","mag-03"]`

**前置校验（任一不过则整体拒绝，不落库）**

1. `templateIds.length` 为奇数且 ≥ 3
2. 每个模板存在，且 `category === "interior"`
3. `sum(模板图槽数) === 原页图片数`（图片守恒）
4. 原页是内页

**行为（单次 `commitWrite`，原子）**

1. 原页被 `templateIds[0]` 原地替换，`templateIds[1..]` 依次插在其后
2. 图片按原页槽顺序**依次**分配到新页的图槽（先到先得，不做智能匹配）
3. 每页继承原页的 `#accentColor` 键与字体 carrier 键 —— **必须做**，见下节
4. 文字槽填模板 `sample` 示例文案
5. 全书重排 `pageIndex`
6. 每页 `bakeAlbumPageHtml`

**返回**：新页的用户口径 pageNo 列表，供 AI 接着调 `update_page_texts` 写文案。

### `delete_page(pageNo)`

- 只接受内页；封面/目录/封尾拒绝
- 图片随页移除，不回流
- 拒绝删到内页数为 0
- 全书重排 `pageIndex`，单次 `commitWrite`

## 为什么新页必须显式继承配色字体

`set_text_colors` / `set_text_fonts` 不是「设置」而是「盖章」：
[packages/design-agent/src/core/album/tools.ts:632](../../packages/design-agent/src/core/album/tools.ts)
把 `page.texts['槽#accentColor']` 逐页写进去再重 bake html，书状态里**没有**一份
「当前全书配色」的记录。

所以新建的页不会自动获得全书配色，会退回模板默认色，视觉上一眼跟旁边不一样。
`split_page` 必须自己把原页的 `#accentColor` 与字体 carrier 键复制到每张新页。

这同时消掉了用户描述的第 4 步「统一风格」—— 不需要 AI 再跑一轮 `set_text_colors`。

## 轮次预算（对着 120 秒天花板）

`design-chat` 路由 `maxDuration = 120`，而 pi-agent-core 的工具循环
（`agent-loop.ts:170` 的 `while (true)`）**没有轮次上限**，design-agent 自身也没有
任何 timeout。全链路唯一的 deadline 就是 Vercel 这 120 秒，超时表现为用户看到
「出错了」（已在生产日志确认，见同日排查）。

选组合工具而非原子工具，主因就是这个：

| 步骤 | 轮次 |
|---|---|
| `list_templates` 看候选 | 1 |
| `split_page` | 1 |
| `update_page_texts`（吃 `updates` 数组，一轮写完所有新页） | 1 |
| 收尾回复 | — |
| **合计** | **3** |

对照原子工具方案：`read_page` + `list_templates` + `insert_page` × N +
`update_page_images` + `update_page_texts` + `set_text_colors` + `set_text_fonts`
= 10 轮以上。更糟的是 `commitWrite` **每次调用立即落库并 `version += 1`**，中途
超时会在用户书里留下已插入但没图没文案的空页。组合工具让拆页要么整个完成、要么
一页没动。

## 接线（CLAUDE.md 点名过的坑）

1. `apps/web/src/app/api/v3/albums/[uuid]/design-chat/route.ts` 的
   `DESIGN_WRITE_TOOLS` 集合补进 `split_page`、`delete_page`。漏了历史回放会丢更新。
2. `apps/web/src/components/album/editor-v2/ChatPanel.tsx` 的
   `DESIGN_CHANGE_CATEGORY` 补进这两个 → `'pages'`。
3. `packages/design-agent/src/core/album/system-prompt.ts` 加一段：拆页流程、
   奇数页约束、图片守恒、拆页与删页的区别（「合并/挤一页」不等于「删掉」，模棱时反问）。

## 前端不需要改

`replacePages`（[apps/web/src/components/album/editor-v2/EditorPort.tsx:3872](../../apps/web/src/components/album/editor-v2/EditorPort.tsx)）
是 `pagesState = pages.map(...)` 整体替换，随后 `rebuildSpreads()` + `repaintBook()`，
不假定页数不变。页数变化天然支持，本轮不动前端渲染。

## 测试

`packages/design-agent/test/` 下新增用例：

- 图片守恒：模板图槽和 ≠ 原页图数 → 拒绝且不落库
- 奇偶：`templateIds.length` 为偶数 → 拒绝
- 类目：传 cover/toc/ending 模板 → 拒绝；拆封面 → 拒绝
- `pageIndex` 插删后全书连续
- 配色字体继承：拆后新页带上原页的 `#accentColor` 与字体 carrier 键
- 删页：图片随页消失、后续页码顺移、删到最后一张内页 → 拒绝
- 已有 `album-contract-parity.test.ts` 纳入两个新工具

跑法（CLAUDE.md）：`cd packages/design-agent && pnpm test`；Web 侧改动跑
`cd apps/web && pnpm test`。仓根 `pnpm test` 撞到第一个失败包就中断，不要只看它。

## 明确不做（YAGNI）

- 合并页（拆页的逆操作）—— 用户明确说删页是独立功能，不是合并
- 删页时照片回流到其他页 / 「未使用照片池」概念
- 拆页时的智能图文匹配（按内容挑哪张图去哪页）—— 先按槽序依次分配
- 拆封面 / 目录 / 封尾
- 给工具循环加轮次上限、给 design-agent 加 timeout —— 是真问题，但属于同日排查
  出的超时议题，另开
- `design-agent-client.ts:70` 的 `AbortSignal.timeout(180_000)` > `maxDuration 120`
  这个失效保险 —— 同上，另开
