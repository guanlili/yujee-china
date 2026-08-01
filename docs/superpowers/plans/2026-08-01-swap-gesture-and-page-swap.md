# 交换手势统一长按 + 整页交换 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复桌面版鼠标 pan 被图片交换手势劫走的问题（统一长按拾起），并新增整页交换（单页↔单页、大页↔大页、大页↔对页）。

**Architecture:** 手势修复只删桌面 swap 接线的 `immediate` 鼠标分支。整页交换分三层：共享纯模块 `page-swap.ts`（交换单位/合法性/置换计算，零 DOM）→ 原子 `POST pages/reorder` 端点（事务内重排 draftJson.pages 或 album_pages 行）→ 桌面画布「调整页序」模式 + 移动端 MobileStrip 交换模式（同一状态机：选中→点目标）。

**Tech Stack:** Next.js App Router、zod、node:test（web 包既有测试跑法）、命令式 DOM（EditorPort）+ React（mobile 子树）。

**Spec:** `docs/specs/2026-08-01-swap-gesture-and-page-swap-design.md`

## Global Constraints

- 页面真相 = HTML：整页交换搬整条记录（含 htmlJson），**绝不逐字段拆搬**。
- mobile 子树不许碰 `document`/`classList`（React 渲染态）。
- 交换排除 cover / toc / ending 类目页（前端置灰 + 服务端二次校验）。
- 置换语义：`permutation[newIndex] = oldIndex`，必须是 0..n-1 完整双射。
- Web 测试：`cd apps/web && pnpm test`；仓根 `pnpm test` 撞第一个失败包即中断。
- `pnpm typecheck` 含 `docs:check`：改动落在带 doc-scope 文档的 paths 内要更新 checked-at。
- 提交信息结尾带 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。

---

### Task 1: 桌面交换手势改回统一长按

**Files:**
- Modify: `apps/web/src/components/album/editor-v2/EditorPort.tsx`（swap 接线 ~L2299-2453）
- Modify: `apps/web/src/components/album/editor-v2/editor-port.css`（grab/grabbing 指针）
- Test: `apps/web/src/components/album/editor-v2/image-swap-wiring.test.ts`

**Interfaces:**
- Consumes: `SWAP_LONG_PRESS_MS`、`exceedsLongPressSlop`（image-swap.ts，不改）
- Produces: 无新接口；`swapPending` 丢掉 `immediate` 字段

- [ ] **Step 1: 更新 wiring 测试**：断言源码中 swap pending 构造**不再有** `pointerType === 'mouse'` 的 immediate 分支、计时器无条件 `setTimeout(...SWAP_LONG_PRESS_MS)`、移动超 slop 走 `cancelSwapPending`。跑测试确认先红。
- [ ] **Step 2: 改 EditorPort.tsx**：
  - `swapPending` 类型删 `immediate`；`onSwapPointerDown` 无条件 `timer: window.setTimeout(...)`。
  - `onSwapPointerMove` pending 分支：超 slop 一律 `cancelSwapPending()`（删 immediate 开拖分支）。
  - 重写 L2299/L2428 两处注释：解释 2026-08-01 拍板「pan 优先，交换统一长按」，替换掉「鼠标不需要按住」的旧理由（保留旧方案为何废弃的一句话历史）。
  - `beginSwapDrag` 里 `clearImageSelection()` 之前：若长按目标就是当前选中图且存在未提交的 live pan 位移，先按已提交 `imagePosJson` 回放 `objectPosition/transform`（防 350ms 内 ≤8px 的微动被视觉残留）。
- [ ] **Step 3: CSS**：`.overview-on [data-image-slot] img { cursor: grab }`（有照片的槽）、`body.swap-dragging { cursor: grabbing }`（已有 swap-dragging 类，确认无冲突后追加）。
- [ ] **Step 4: 跑 `image-swap-wiring.test.ts` + image-swap.test.ts 全绿。**
- [ ] **Step 5: Commit** `fix(editor): 桌面图片交换改回长按拾起,鼠标 pan 复活`

### Task 2: page-swap 纯模块（TDD）

**Files:**
- Create: `apps/web/src/components/album/editor-v2/page-swap.ts`
- Test: `apps/web/src/components/album/editor-v2/page-swap.test.ts`

**Interfaces:**
- Consumes: `buildSpreads`、`Spread`（spreads.ts）；`getTemplate`（contracts）
- Produces:
  ```ts
  export type PageSwapUnit = { kind: 'single' | 'full' | 'pair'; indices: number[] };
  // indices = 页数组下标(升序,pair 为相邻两条;pageIndex 与数组下标恒等)
  export function swapUnitOfPage(pages: EditorPage[], pageArrayIndex: number): PageSwapUnit | null;
  // cover/toc/ending → null;pair 的一侧 → { kind:'single', indices:[i] };full → { kind:'full', indices:[i] }
  export function pairUnitOfPage(pages: EditorPage[], pageArrayIndex: number): PageSwapUnit | null;
  // 该页所在 pair 的整体单元 { kind:'pair', indices:[l,r] }(两侧齐全才返回,solo/full → null)
  export function canSwapUnits(a: PageSwapUnit, b: PageSwapUnit): boolean;
  // single↔single、full↔full、full↔pair;indices 相交 → false
  export function buildSwapPermutation(pageCount: number, a: PageSwapUnit, b: PageSwapUnit): number[] | null;
  // 块对调后的完整置换 perm[newIndex]=oldIndex;canSwapUnits 不过 → null
  ```

- [ ] **Step 1: 写失败测试**（用最小 EditorPage 桩 + 真实模板 id，与 spreads.test.ts 同法取一个 spread 模板 id 和普通模板 id）：
  - 单↔单原地对调：perm 只动两位。
  - 大↔大原地对调。
  - 大↔对页块对调：手推 `[c, p0,p1, m0,m1, F, e]` 交换 (p0,p1)↔F 后的期望 perm，断言中间页平移正确且是双射。
  - cover/toc/ending → unit null；单↔大 canSwap false；indices 相交 false。
- [ ] **Step 2: 跑测试确认红。**
- [ ] **Step 3: 实现**（swapUnitOfPage 走 buildSpreads 判 full/pair；类目用 `getTemplate(templateId)?.category`；buildSwapPermutation：identity 数组上把 a、b 两个块按位置高低切五段重拼）。
- [ ] **Step 4: 跑测试全绿。**
- [ ] **Step 5: Commit** `feat(editor): page-swap 纯逻辑(交换单位/合法性/置换)`

### Task 3: 原子 reorder 端点

**Files:**
- Create: `apps/web/src/app/api/v1/albums/[uuid]/pages/reorder/route.ts`
- Modify: `apps/web/src/services/album/album-service.ts`（新增 `reorderPages`）
- Modify: `apps/web/src/repositories/*`（album_pages 批量 pageIndex 重写，按现有 repo 模式）
- Test: 对齐 album-service 既有测试文件的组织方式新增用例

**Interfaces:**
- Consumes: `readStoryDraft`、`albumRepo.findByIdForUpdate`、`getTemplate`
- Produces: `POST /api/v1/albums/{uuid}/pages/reorder` body `{ permutation: number[] }` → `ok({ updated: true })`
- `albumService.reorderPages(userId, albumId, permutation): Promise<{ updated: true }>`

- [ ] **Step 1: 写失败测试**：置换长度错/非双射/移动 cover 页 → VALIDATION_FAILED；draft 路径重排后 pages 顺序与 pageIndex 均正确；COMPLETED → EDITING。
- [ ] **Step 2: route.ts**：zod `{ permutation: z.array(z.number().int().nonnegative()).min(2) }`，requireAuth + parseBody + fromException，样式照抄 `pages/[idx]/route.ts`。
- [ ] **Step 3: 服务实现**：事务 + 行锁；校验双射与 n 匹配；对每个 `permutation[newIdx] !== newIdx` 的页校验旧位置页类目不在 {cover,toc,ending}；draft 路径 `pages[newIdx] = { ...old[perm[newIdx]], pageIndex: newIdx }`；无 draft 路径批量重写 album_pages 行 pageIndex；`COMPLETED→EDITING`；置换触及 0 号位则清封面缩略图（防御，正常被类目校验挡住）。
- [ ] **Step 4: 测试全绿。**
- [ ] **Step 5: Commit** `feat(api): POST pages/reorder 原子整页重排端点`

### Task 4: 桌面「调整页序」模式

**Files:**
- Modify: `apps/web/src/components/album/editor-v2/EditorPort.tsx`（view-ctrl dock 按钮、actions 表、renderOverview 状态标注、#ovGrid 点击分流、Esc）
- Modify: `apps/web/src/components/album/editor-v2/editor-port.css`
- Test: `apps/web/src/components/album/editor-v2/page-swap-wiring.test.ts`（新）

**Interfaces:**
- Consumes: Task 2 全部导出；`replacePages`/`rebuildSpreads`/`repaintBook`/`renderOverview`
- Produces: `data-action="togglePageSwap"` 按钮 `#pageSwapBtn`；body 类 `page-swap-on`；`.pswap-selected`/`.pswap-dim` 视觉类

- [ ] **Step 1: 写 wiring 测试（source-regex 风格）**：断言按钮存在、actions 表有 togglePageSwap、`page-swap-on` 下 surfaceClick/图片交换接线让路、点击走 pageSwapClick、成功走 reorder fetch + 失败回滚。
- [ ] **Step 2: UI**：view-ctrl dock 加按钮（上下箭头交换图标，`data-tip` 调整页序/Reorder pages）；模式态 `pageSwapMode: PageSwapUnit | null | false`（false=关，null=开着未选中，unit=已选）。进入模式：清图片选中/隐藏工具条/`bodyEl.classList.add('page-swap-on')`；Esc 与再点按钮退出。
- [ ] **Step 3: 点击分流**：`#ovGrid` 点击委托里模式开启时改走 `pageSwapClick(pageArrayIndex)`：无选中 → `swapUnitOfPage`（null 则忽略）标 `.pswap-selected`（pair 目标整体描边）并给所有非法目标页加 `.pswap-dim`；再点选中单元 → 取消；点合法目标 → `commitPageSwap`。选中大页时 pair 目标用 `pairUnitOfPage` 整体判定。`renderOverview` 重建 innerHTML 后按模式态重挂类（抽 `applyPageSwapMarks()`）。
- [ ] **Step 4: commitPageSwap**：`buildSwapPermutation` → 本地按 perm 重排 `pagesState` 并重写 pageIndex → `rebuildSpreads() + repaintBook()`（保持模式，清选中态）→ `await fetch reorder`；失败：按 perm 逆置换回滚 + `alert(t)` 风格提示（对齐既有错误提示口径）。
- [ ] **Step 5: 手势互斥**：`page-swap-on` 时 `onSwapPointerDown`（图片交换）与 surfaceClick 的选图路径直接 return；画布平移/缩放不受影响。
- [ ] **Step 6: CSS**：`.pswap-selected` 描边（沿用选中页高亮色系）、`.pswap-dim { opacity:.35; pointer-events:auto }`（仍可点但视觉压暗）、按钮 active 态。
- [ ] **Step 7: 测试全绿 + Commit** `feat(editor): 桌面画布整页交换(调整页序模式)`

### Task 5: 移动端整页交换

**Files:**
- Modify: `apps/web/src/components/album/editor-v2/mobile/MobileEditorRoot.tsx`（模式态 + reorder 调用 + 入口按钮）
- Modify: `apps/web/src/components/album/editor-v2/mobile/MobileStrip.tsx`（swap 模式 props + 面级点击）
- Modify: 移动端样式文件（strip 高亮/压暗）
- Test: 并入 `page-swap-wiring.test.ts`

**Interfaces:**
- Consumes: Task 2 纯模块、Task 3 端点
- Produces: `MobileStripProps` 追加可选 `swap?: { selected: number[] | null; valid: (pi: number) => boolean; onPick: (pi: number) => void }`

- [ ] **Step 1: wiring 测试**：MobileStrip 有 swap 分支、Root 有模式态与 reorder fetch、React 态不碰 document。
- [ ] **Step 2: MobileStrip**：swap 模式下 face `<span>` 变可点（自身 onClick 停止冒泡防触发 onJump），`data-pswap="sel|ok|dim"` 三态由 props 算出，CSS 按属性上色。
- [ ] **Step 3: MobileEditorRoot**：浏览态 strip 旁加「调整页序」入口；态机与桌面同（选中 unit → 点合法 face → 本地重排 setPages + fetch reorder，失败回滚 + 既有 toast 口径）。
- [ ] **Step 4: 测试全绿 + Commit** `feat(editor): 移动端整页交换(预览栏选中→点目标)`

### Task 6: 全量验证 + 文档时效

- [ ] **Step 1:** `cd apps/web && pnpm test` 全绿。
- [ ] **Step 2:** 仓根 `pnpm typecheck`（含 docs:check）——涉及 editor-v2 的 doc-scope 文档核对后推进 checked-at。
- [ ] **Step 3:** 若 spec 与实现有出入，回改 spec 后一并提交。
- [ ] **Step 4: Commit + 汇总。**
