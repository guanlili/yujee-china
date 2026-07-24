# 画布双页排版（跨页）设计

- Issue: #303
- 分支: `feat/canvas-spread-wedding`
- 日期: 2026-07-22

## 目标

支持**跨页大图 / 通栏版式**：一个版式横跨左右两页，大图或大标题穿过中缝。
同时新增一批婚纱场景版式（含跨页），走既有 Figma 复刻流水线。

## 已定决策

| 议题 | 决策 |
|---|---|
| 双页含义 | 跨页大图 / 通栏版式（不是"左右页协同构图"，也不是纯编辑器视图） |
| 技术路线 | **C：宽版页**。一个跨页 = 一个模板，画布 1588×1123，渲染/导出时才切成左右两面 |
| engine | **0 改动**。分页链路不动，符合 issue 口径 |
| 操作台（线上画板） | **本轮不动**。换版式面板另开 issue |
| PDF 导出 | 双宽渲一次，**从中间切成两页 A4** 写入 PDF。PDF 保持纯竖版，可直送印刷 |
| 婚纱版式 | 只做版式模板（不做场景识别、不做字体配色、不做选图规则）。稿件由用户给 Figma fileKey |
| 页码 | 后置。先让双页在数据/配对层真的是一个双页单元，页码作为展示层 pass 自然跟上 |

## 为什么选 C（宽版页）而不是 L/R 模板对

仓里已有 mag-52/mag-53 —— 一张 Figma 1190×842 跨页拼版被手工切成左右两张标准 A4，
跨页元素用超界坐标 + `overflow:hidden` 裁掉溢出。这条路有两个致命问题：

1. **成对纯靠运气**。engine 选模板是加权随机（`candidate_gen_v3._weighted_pick_template`），
   它不知道左右页概念。L 被选中时 R 不会跟着来，L 也可能落到右页——跨页大图直接断掉。
   要修就得改 engine 分页，撞上 issue 明令"先停下确认"的红线。
2. **每做一个新跨页都要手算负坐标**，设计稿到模板的换算成本翻倍。

C 路线下，engine 眼里跨页就是普通一页（`skeleton_v3.POOLS` 按 `category × 图槽数` 索引，
自然进池），分页数学不变，天然不可能被拆散。设计稿也能按 Figma 原图直接落。

已预留但本轮**不启用**的 `TemplatePairing`（`forced/with/side`）保持原样，
`spreads.ts` 里那条 `TODO(phase-2b)` 也保持——C 路线让它不再必要。

## 架构

### 单一新概念：`spread` 标记 + `pageBox()` 帮手

```ts
// packages/contracts/src/templates.ts
TemplateDef = { ..., spread?: boolean }   // 只允许 category === 'interior'

// packages/contracts/src/render/constants.ts
export function pageBox(templateId: string): { width: number; height: number }
// spread 模板 → { width: PAGE.width * 2, height: PAGE.height }
// 其余      → PAGE
```

全仓写死 `PAGE.width` 的渲染面改调 `pageBox(templateId)`。
**单页模板行为逐像素不变**，这是本设计的核心约束与回归基线。

### 改动清单

**① 契约层（4 处，缺一即挂）**

| 文件 | 改动 |
|---|---|
| `packages/contracts/src/templates.ts:99` | `TemplateDef` 加 `spread`；`superRefine` 限 interior，且与 `pairing` 互斥 |
| `packages/contracts/scripts/gen-templates.ts` | 内联 zod 镜像同步，否则 `templates:check` 报漂移 |
| `engine/src/workflows/core/layout/templates.py`、`engine/src/contracts/schemas.py` | **Python 侧镜像**。两边都是 strict schema，不加则新模板 JSON 一落地 engine 加载即失败 |
| `packages/contracts/src/render/constants.ts:100` | 新增 `pageBox()` |

**② 渲染层（8 个面）**

`templates/web-utils.tsx:17`（React 模板根壳）·
`EditorPort.tsx:1278 faceHTML` + `:1432` 离屏截图盒 ·
`FlipBook.tsx:86,93` · `PagePreview.tsx:37,48` ·
`lib/pdf/render-raster.ts` · `lib/export/collage.ts` + `single-pages.ts` ·
`lib/photo/candidate-thumbnail.tsx`

`candidate-thumbnail.tsx` 优先级最高：**LLM 评委靠它看图选排版方案**，
双宽渲错评委就选错，错误会一路传导到成品。

**③ 配对与页码层**

- `spreads.ts buildSpreads`：spread 模板独占一整个 spread。
  关键坑——遇到它必须先 `flushPending()`，否则它会被当右半页塞进上一对，整本错位。
  `Spread` 结构加一个表达"这一格由一个双页页占满"的形态。
- `page-html-dom.ts` 三函数联动：
  - `pageFolioNumbers`：一个双页页吃掉**两个**页码
  - `pageFolioSides`：双页页需要"两侧都要"
  - `applyFolioOverlay`：一页里注入两个页码（左下 + 右下）
- `EditorPort.paintSpread:1860`：双页页时左右两 cell 合成一个画。

**④ engine：0 改动**，仅需验证新模板进池后分页不异常。

### PDF 切页

`render-raster.ts` 现在逐页 `html2canvas` 截 `PAGE.width × PAGE.height`。
双页页改为：按 `pageBox()` 截一张 1588×1123（`scale:3` 不变），
再用 canvas 二次裁切成左右两张 794×1123，依次 `addPage` 写入。
PDF 页数因此 > 数据页数，这是预期行为。

## 单页/双页混排

后续模板批次会单页双页混着来。混排的正确性全部落在 `buildSpreads`：
它是唯一决定"哪些数据页占哪个物理半页"的地方（`pageFolioSides` 目前重复实现了
同一套配对逻辑，本轮**抽成公共函数**，消除双份真相）。

## 测试

- `registry-parity.test.ts` — 三处注册一致（已有，自动覆盖新模板）
- 新增 `spreads.test.ts` 用例：单/双页混排、双页页出现在奇数位、双页页紧邻 cover/ending
- 新增页码用例：双页页吃两号、两侧各一个 folio
- 回归基线：**任一现有单页模板的渲染输出逐像素不变**

## 明确不做（YAGNI）

- 场景识别 / 婚纱字体配色 / 婚纱选图排序
- 线上画板的"换版式"面板（跨页版式本轮仍只由 engine 随机选中）
- `EditorPort.tsx`（4685 行）与 `editor-port.css`（2203 行）的重构
- 启用 `TemplatePairing`
- 印刷出血位 / 拼版（imposition）
