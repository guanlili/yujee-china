# 页面顺序调整弹窗(拖拽插入重排)实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 两端各自的「调整页面顺序」弹窗——网格缩略图拖拽插入重排,点「完成」发一次原子 reorder;旧点选式整页交换模式全部退场。

**Architecture:** 共享零 DOM 纯逻辑 `page-reorder.ts`(工作序/合法缝隙/置换/指针几何)+ 共享缩略渲染缝 `pageFaceHTML`;桌面走 EditorPort 命令式 DOM 弹窗规范(`.modal-overlay` + classList 开合 + `data-action`),移动端走 `mobile/modals/` React + `ModalHost` 规范。后端 `POST pages/reorder` 零改动(已接受任意双射,锚定页服务端把关)。

**Tech Stack:** Next.js / React / TypeScript;测试 `tsx --test`(node:test + node:assert);设计文档 `docs/specs/2026-08-02-page-reorder-modal-design.md`。

## Global Constraints

- 手势常量复用 `image-swap.ts`:`SWAP_LONG_PRESS_MS = 350`、`SWAP_LONG_PRESS_SLOP = 8`;桌面鼠标**移动超 8px 立即拾起**,移动端**长按 350ms 拾起**(期间移动超 8px 回落滚动)。
- 置换语义 `perm[newIndex] = oldIndex`(与 reorder 端点 body 一致);恒等置换零请求。
- 锚定页 = 模板 category ∈ {cover, toc, ending}:不可拖、任何移动不得使其下标变化。
- 「取消」/遮罩/Esc(桌面)直接丢弃,不加二次确认。提交前 `order.length !== pages.length` → 提示后关窗不提交。
- 移动端子树守则:不碰 `document`,状态住容器层。
- 验证命令:`pnpm --filter @yujee/web test`;收尾跑 `pnpm typecheck`(含 docs:check)。
- 提交信息结尾加 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。

---

### Task 1: 共享纯逻辑 `page-reorder.ts`(TDD)

**Files:**
- Create: `apps/web/src/components/album/editor-v2/page-reorder.ts`
- Test: `apps/web/src/components/album/editor-v2/page-reorder.test.ts`

**Interfaces:**
- Consumes: `getTemplate` from `@yujee/contracts/templates`。
- Produces(后续两端接线全靠这些签名):
  - `isAnchoredTemplate(templateId: string): boolean`
  - `legalGaps(templateIds: string[], order: number[], from: number): number[]`
  - `applyMove(order: number[], from: number, gap: number): number[]`
  - `buildInsertPermutation(order: number[]): number[] | null`
  - `type CellRect = { left: number; top: number; width: number; height: number }`
  - `gapFromPointer(cells: CellRect[], legal: number[], x: number, y: number, maxDist?: number): number | null`

- [ ] **Step 1: 写失败测试**(与 `page-swap.test.ts` 同法从注册表现查类目,不硬编码 id)

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { TEMPLATE_IDS, TEMPLATES } from '@yujee/contracts/templates';
import {
  applyMove,
  buildInsertPermutation,
  gapFromPointer,
  isAnchoredTemplate,
  legalGaps,
  type CellRect,
} from './page-reorder';

/* 页序弹窗的纯逻辑(2026-08-02 设计):工作序 order[pos] = 原始下标;缝隙 g 指
   「插到工作序第 g 条之前」(0..n);合法 ⇔ 移动后没有任何锚定页下标变化。 */

const idOf = (pred: (t: (typeof TEMPLATES)[string]) => boolean) =>
  TEMPLATE_IDS.find((id) => pred(TEMPLATES[id]!));
const COVER = idOf((t) => t.category === 'cover')!;
const TOC = idOf((t) => t.category === 'toc')!;
const ENDING = idOf((t) => t.category === 'ending')!;
const BODY = idOf((t) => !['cover', 'toc', 'ending'].includes(t.category))!;

// 典型书:封面 目录 A B C 封尾(A/B/C 是内容页,原始下标 2/3/4)
const IDS = [COVER, TOC, BODY, BODY, BODY, ENDING];
const IDENTITY = [0, 1, 2, 3, 4, 5];

test('锚定识别:cover/toc/ending 锚定,内容页不锚定', () => {
  assert.equal(isAnchoredTemplate(COVER), true);
  assert.equal(isAnchoredTemplate(TOC), true);
  assert.equal(isAnchoredTemplate(ENDING), true);
  assert.equal(isAnchoredTemplate(BODY), false);
});

test('legalGaps:内容页只能落在内容区缝隙(不许推挤目录/封尾)', () => {
  // 拖 A(工作序位 2):g=0/1 会把封面或目录往后推,g=6 会把封尾往前拉,都非法。
  assert.deepEqual(legalGaps(IDS, IDENTITY, 2), [2, 3, 4, 5]);
});

test('legalGaps 防御:书中间意外出现锚定页时,移动不得跨过它', () => {
  const ids = [COVER, BODY, ENDING, BODY]; // 畸形但要稳:ENDING 在中间
  assert.deepEqual(legalGaps(ids, [0, 1, 2, 3], 1), [1, 2]);
  assert.deepEqual(legalGaps(ids, [0, 1, 2, 3], 3), [3, 4]);
});

test('applyMove:前移/后移/原地(g=from 与 g=from+1 都是无操作)', () => {
  assert.deepEqual(applyMove(IDENTITY, 4, 2), [0, 1, 4, 2, 3, 5]); // C 插到 A 前
  assert.deepEqual(applyMove(IDENTITY, 2, 5), [0, 1, 3, 4, 2, 5]); // A 插到封尾前
  assert.deepEqual(applyMove(IDENTITY, 3, 3), IDENTITY);
  assert.deepEqual(applyMove(IDENTITY, 3, 4), IDENTITY);
});

test('连拖复合 + buildInsertPermutation 的 perm[newIndex]=oldIndex 语义', () => {
  let order = IDENTITY;
  order = applyMove(order, 4, 2); // [0,1,4,2,3,5]
  order = applyMove(order, 3, 5); // [0,1,4,3,2,5]
  const perm = buildInsertPermutation(order)!;
  assert.deepEqual(perm, [0, 1, 4, 3, 2, 5]);
  // 端点/提交侧的应用公式:next[newIdx] = prev[perm[newIdx]]
  const prev = ['封面', '目录', 'A', 'B', 'C', '封尾'];
  assert.deepEqual(perm.map((oldIdx) => prev[oldIdx]), ['封面', '目录', 'C', 'B', 'A', '封尾']);
  // 双射性
  assert.equal(new Set(perm).size, perm.length);
});

test('恒等工作序 → null(调用方零请求短路)', () => {
  assert.equal(buildInsertPermutation(IDENTITY), null);
  assert.equal(buildInsertPermutation(applyMove(IDENTITY, 3, 4)), null);
});

test('gapFromPointer:取最近合法缝隙,行尾/行首双锚点,超距返回 null', () => {
  // 两行布局,每格 100×150,行内 3 格:pos0/1/2 在 y=0 行,pos3/4/5 在 y=160 行
  const cell = (cx: number, cy: number): CellRect => ({ left: cx, top: cy, width: 100, height: 150 });
  const cells = [cell(0, 0), cell(110, 0), cell(220, 0), cell(0, 160), cell(110, 160), cell(220, 160)];
  const legal = [2, 3, 4, 5];
  // 指针贴近第 1 行第 2 格左缘 → 缝隙 2
  assert.equal(gapFromPointer(cells, legal, 218, 75, 160), 2);
  // 行尾:指针在第 1 行末格右侧 → 缝隙 3 的「上一格右缘」锚点接住
  assert.equal(gapFromPointer(cells, legal, 330, 75, 160), 3);
  // 行首:指针在第 2 行首格左缘 → 也是缝隙 3(双锚点等价)
  assert.equal(gapFromPointer(cells, legal, 2, 235, 160), 3);
  // 距离全部超阈 → null(拖在锁定区上空不给插入条)
  assert.equal(gapFromPointer(cells, legal, 2000, 2000, 160), null);
  // 非法缝隙永不返回
  assert.equal(gapFromPointer(cells, [5], 0, 0, 10_000), 5);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/web && pnpm tsx --test src/components/album/editor-v2/page-reorder.test.ts`
Expected: FAIL(模块不存在)。

- [ ] **Step 3: 实现 `page-reorder.ts`**

```ts
/* ════════════════════════════════════════════════════════════════════════════
   page-reorder —— 页序弹窗的纯逻辑层。桌面弹窗与移动端 ReorderSheet 共用。
   (2026-08-02 设计:docs/specs/2026-08-02-page-reorder-modal-design.md)

   ── 插入重排,而不是块对调 ────────────────────────────────────────────────
   与已退场的 page-swap(只做块对调)相反:用户拍板要任意插入,接受「单页插入
   使下游全部翻面」的装订学后果 —— 弹窗按工作序实时重算页码/贴边角标,把这个
   后果如实亮给用户,由用户自己定夺。
   ── 概念 ──────────────────────────────────────────────────────────────────
   · 工作序 order:order[pos] = 原始下标(打开弹窗那一刻的 0..n-1),弹窗内连拖
     多次只变换这个数组;它本身就是 reorder 端点要的 perm[newIndex]=oldIndex。
   · 缝隙 g:「插到工作序第 g 条之前」,取值 0..n,与原始下标无关。
   · 合法 ⇔ 移动后没有任何锚定页(cover/toc/ending)的下标变化。锚定页天然
     居于头尾,但判定用通则模拟,书中间意外出现锚定页也不会被平移殃及。
   全部纯函数、零 DOM:node 直测;指针→缝隙的判定也在这里,DOM 侧只量 rect。
   ════════════════════════════════════════════════════════════════════════════ */

import { getTemplate } from '@yujee/contracts/templates';

const ANCHORED_CATEGORIES = new Set(['cover', 'toc', 'ending']);

/** 锚定页:锁定不可拖,也不许被别的移动推挤(服务端 reorderPages 二次把关)。 */
export function isAnchoredTemplate(templateId: string): boolean {
  const category = getTemplate(templateId)?.category;
  return category !== undefined && ANCHORED_CATEGORIES.has(category);
}

/** 把工作序第 from 条抽出、插到缝隙 g(「第 g 条之前」)。g=from / g=from+1 是无操作。 */
export function applyMove(order: number[], from: number, gap: number): number[] {
  const next = order.slice();
  const [moved] = next.splice(from, 1);
  next.splice(gap > from ? gap - 1 : gap, 0, moved!);
  return next;
}

/** 拖起工作序第 from 条时所有合法缝隙。直接模拟每个 g 再查锚定页有没有挪窝 ——
 *  n 是一本书的页数,O(n²) 不值得换更聪明的写法。 */
export function legalGaps(templateIds: string[], order: number[], from: number): number[] {
  const out: number[] = [];
  for (let g = 0; g <= order.length; g++) {
    const next = applyMove(order, from, g);
    let ok = true;
    for (let pos = 0; pos < next.length; pos++) {
      if (next[pos] !== order[pos] && isAnchoredTemplate(templateIds[next[pos]!]!)) {
        ok = false;
        break;
      }
    }
    if (ok) out.push(g);
  }
  return out;
}

/** 工作序 → reorder 端点置换。恒等返回 null,调用方零请求短路。 */
export function buildInsertPermutation(order: number[]): number[] | null {
  return order.some((oldIdx, newIdx) => oldIdx !== newIdx) ? order.slice() : null;
}

export type CellRect = { left: number; top: number; width: number; height: number };

/** 指针 → 最近合法缝隙。缝隙 g 有两个视觉锚点:第 g 格左缘 与 第 g-1 格右缘
 *  (换行处两者不同,双锚点让行尾/行首都吸得到);全部超 maxDist → null
 *  (拖在锁定区上空不给插入条)。cells 与 (x,y) 必须在同一坐标系。 */
export function gapFromPointer(
  cells: CellRect[],
  legal: number[],
  x: number,
  y: number,
  maxDist = 160,
): number | null {
  let best: number | null = null;
  let bestD = Infinity;
  for (const g of legal) {
    const after = cells[g];
    const before = cells[g - 1];
    const anchors: Array<{ ax: number; ay: number }> = [];
    if (after) anchors.push({ ax: after.left, ay: after.top + after.height / 2 });
    if (before) anchors.push({ ax: before.left + before.width, ay: before.top + before.height / 2 });
    for (const { ax, ay } of anchors) {
      const d = Math.hypot(x - ax, y - ay);
      if (d < bestD) {
        bestD = d;
        best = g;
      }
    }
  }
  return bestD <= maxDist ? best : null;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/web && pnpm tsx --test src/components/album/editor-v2/page-reorder.test.ts`
Expected: PASS(全部用例)。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/album/editor-v2/page-reorder.ts apps/web/src/components/album/editor-v2/page-reorder.test.ts
git commit -m "feat(editor): page-reorder 纯逻辑(工作序/合法缝隙/置换/指针几何)"
```

---

### Task 2: 桌面弹窗 + 桌面旧模式退场

**Files:**
- Modify: `apps/web/src/components/album/editor-v2/EditorPort.tsx`
- Modify: `apps/web/src/components/album/editor-v2/editor-port.css`
- Modify: `apps/web/src/components/album/editor-v2/editor-coordinator.ts`(i18n)

**Interfaces:**
- Consumes: Task 1 全部导出;既有闭包内设施 `pagesState` / `rebuildSpreads()` / `repaintBook()` / `byId()` / `t()` / `pageFaceHTML` / `pageFolioInfos` / `SWAP_LONG_PRESS_SLOP` / `cancelSwapPending()` / `endSwapDrag()` / `clearImageSelection()` / `hideElementToolbar()`。
- Produces: `data-action` 三件:`openPageReorder` / `closePageReorder` / `confirmPageReorder`;弹窗 DOM id `pageReorderModal` / `preorderGrid`;i18n 键 `pageReorderFailed` / `pageReorderChanged`。

- [ ] **Step 1: i18n(editor-coordinator.ts)**

zh 表(105 行附近)删 `pageSwapFailed`,加:

```ts
    pageReorderFailed: '页序没有存上，已恢复原顺序，请重试',
    pageReorderChanged: '书的内容刚有更新，这次调整没有提交，请重新打开',
```

en 表(264 行附近)删 `pageSwapFailed`,加:

```ts
    pageReorderFailed: 'The new order was not saved; restored — please retry',
    pageReorderChanged: 'The book changed elsewhere; nothing was submitted — please reopen',
```

- [ ] **Step 2: 弹窗 JSX**

在 `boardBgModal`(:1076 起的 `.modal-overlay` 块)**之后**平级插入(`zh` 变量在此作用域可用):

```tsx
      {/* 页序弹窗:网格拖拽插入重排(2026-08-02 设计)。命令式开合,同 boardBgModal 一族;
          网格内容/拖拽全在效应闭包里(renderPreorderGrid + preorder pointer 三兄弟)。 */}
      <div className="modal-overlay" id="pageReorderModal" data-overlay-close>
        <div className="modal-card preorder-card" role="dialog" aria-modal="true" aria-labelledby="preorderTitle" data-testid="page-reorder-modal">
          <div className="preorder-head">
            <h3 id="preorderTitle" className="font-display text-[17px] font-bold">{zh ? '调整页面顺序' : 'Reorder pages'}</h3>
            <p className="preorder-hint">{zh ? '拖动页面到新位置。封面、目录与封尾固定不动。' : 'Drag pages to a new spot. Cover, contents and ending stay fixed.'}</p>
            <button className="board-bg-close" data-action="closePageReorder" aria-label="close">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
          <div className="preorder-grid" id="preorderGrid" />
          <div className="preorder-foot">
            <button className="preorder-btn" data-action="closePageReorder" data-testid="preorder-cancel">{zh ? '取消' : 'Cancel'}</button>
            <button className="preorder-btn preorder-btn-primary" data-action="confirmPageReorder" data-testid="preorder-done">{zh ? '完成' : 'Done'}</button>
          </div>
        </div>
      </div>
```

- [ ] **Step 3: 工具栏按钮改开弹窗**

:5972 起的按钮:`id="pageSwapBtn"` → `id="pageReorderBtn"`,`data-action="togglePageSwap"` → `data-action="openPageReorder"`,`data-testid="page-swap-btn"` → `data-testid="page-reorder-btn"`;tooltip/aria 文案与 `data-i18n-tip="pageSwap"` 保持不变(键还在,文本「调整页序」照旧)。注释改为「页序弹窗入口」。

- [ ] **Step 4: 删旧模式、装新命令式块**

删除(全部在效应闭包内):

- `onSwapKeydown` 里 `if (pageSwapOn) {...}` 分支(:2758-2761),换成:

```ts
      if (byId('pageReorderModal')?.classList.contains('open')) {
        e.stopPropagation();
        closePageReorder();
      }
```

- 「整页交换」整块 :2764-2859(`pageSwapOn`/`pageSwapSel`/`pageSwapTargetUnit`/`applyPageSwapMarks`/`setPageSwapMode`/`onPageSwapClick`/`commitPageSwap`)。
- 照片手势守卫里的 `if (pageSwapOn) return;`(:2656)与 :2758 一带对 `pageSwapOn` 的引用——删除后全文不得再出现 `pageSwapOn`。
- overview 点击分发里调 `onPageSwapClick` 的分支(搜 `onPageSwapClick` 的调用点一并删)。
- actions 表(:5552)删 `togglePageSwap: () => setPageSwapMode(!pageSwapOn)` 一行。
- `import { ... } from './page-swap'` 整行删除。

在原 :2764 位置装入新块:

```ts
    // ── 页序弹窗:网格拖拽插入重排(2026-08-02 设计)──────────────────────────
    // 弹窗内只动工作序(order[pos]=原始下标);「完成」合成一个置换发一次原子
    // reorder,乐观重排 + 失败回滚,与旧整页交换同口径。合法缝隙/置换/指针几何
    // 全部来自共享 page-reorder.ts,这里只做 DOM:渲格子、量 rect、画插入条。
    let preorder: number[] | null = null; // null = 弹窗关
    let preorderDrag: {
      from: number;
      startX: number;
      startY: number;
      lifted: boolean;
      gap: number | null;
    } | null = null;
    const PREORDER_CELL_H = 150;

    function preorderCells(): HTMLElement[] {
      return [...(byId('preorderGrid')?.querySelectorAll<HTMLElement>('.preorder-cell') ?? [])];
    }
    function renderPreorderGrid() {
      const grid = byId('preorderGrid');
      if (!grid || !preorder) return;
      const ids = preorder.map((orig) => pagesState[orig]!.templateId);
      const folios = pageFolioInfos(ids);
      grid.innerHTML = preorder
        .map((orig, pos) => {
          const page = pagesState[orig]!;
          const anchored = isAnchoredTemplate(page.templateId);
          const box = pageBox(page.templateId);
          const w = Math.round((PREORDER_CELL_H * box.width) / box.height);
          const f = folios[pos]!;
          const face = pageFaceHTML(page, w, PREORDER_CELL_H, faceCtx(page, resolveImage));
          // 角标贴边即语义:左页贴左下、右页贴右下;双宽页两角都贴;锚定页锁标。
          const badges = anchored
            ? '<span class="preorder-lock" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg></span>'
            : f.folio === null
              ? ''
              : typeof f.folio === 'number'
                ? `<span class="preorder-no preorder-no-${f.side}">${f.folio}</span>`
                : `<span class="preorder-no preorder-no-left">${f.folio.left}</span><span class="preorder-no preorder-no-right">${f.folio.right}</span>`;
          return (
            `<div class="preorder-cell${anchored ? ' preorder-locked' : ''}" data-pos="${pos}"` +
            ` style="width:${w}px;height:${PREORDER_CELL_H}px">${face}${badges}</div>`
          );
        })
        .join('');
    }
    function openPageReorder() {
      // 进入前清掉画布上的编辑残留;半途的图片交换候选/拖动一并作废。
      cancelSwapPending();
      if (swapDrag) endSwapDrag(false);
      clearImageSelection();
      hideElementToolbar();
      preorder = pagesState.map((_, i) => i);
      renderPreorderGrid();
      byId('pageReorderModal')?.classList.add('open');
    }
    function closePageReorder() {
      preorder = null;
      preorderDrag = null;
      byId('preorderGrid')?.replaceChildren();
      byId('preorderGhost')?.remove();
      byId('preorderBar')?.remove();
      byId('pageReorderModal')?.classList.remove('open');
    }
    async function confirmPageReorder() {
      if (!preorder) return;
      // 弹窗开着的时候书被外部改了(设计对话等):这次调整作废,不硬提交。
      if (preorder.length !== pagesState.length) {
        closePageReorder();
        alert(t('pageReorderChanged'));
        return;
      }
      const perm = buildInsertPermutation(preorder);
      closePageReorder();
      if (!perm) return; // 恒等:零请求
      const prev = pagesState;
      pagesState = perm.map((oldIdx, newIdx) => ({ ...prev[oldIdx]!, pageIndex: newIdx }));
      rebuildSpreads();
      repaintBook();
      try {
        const res = await fetch(`/api/v1/albums/${albumId}/pages/reorder`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ permutation: perm }),
        });
        if (!res.ok) throw new Error(`reorder ${res.status}`);
      } catch {
        pagesState = prev;
        rebuildSpreads();
        repaintBook();
        alert(t('pageReorderFailed'));
      }
    }
    function preorderInsertBar(): HTMLElement {
      let bar = byId('preorderBar');
      if (!bar) {
        bar = document.createElement('div');
        bar.id = 'preorderBar';
        bar.className = 'preorder-bar';
        byId('preorderGrid')?.appendChild(bar);
      }
      return bar;
    }
    const onPreorderDown = (e: PointerEvent) => {
      if (!preorder || e.button !== 0) return;
      const cell = (e.target as HTMLElement).closest<HTMLElement>('.preorder-cell');
      if (!cell || cell.classList.contains('preorder-locked')) return;
      e.preventDefault();
      preorderDrag = { from: Number(cell.dataset.pos), startX: e.clientX, startY: e.clientY, lifted: false, gap: null };
      byId('preorderGrid')?.setPointerCapture(e.pointerId);
    };
    const onPreorderMove = (e: PointerEvent) => {
      const grid = byId('preorderGrid');
      const d = preorderDrag;
      if (!grid || !preorder || !d) return;
      if (!d.lifted) {
        // 桌面手感:按住一拖立即拾起(超 slop),无长按仲裁 —— 弹窗内没有 pan 竞争。
        if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) <= SWAP_LONG_PRESS_SLOP) return;
        d.lifted = true;
        const src = preorderCells()[d.from];
        src?.classList.add('preorder-dragging');
        const ghost = document.createElement('div');
        ghost.id = 'preorderGhost';
        ghost.className = 'preorder-ghost';
        ghost.innerHTML = src?.innerHTML ?? '';
        ghost.style.width = `${src?.offsetWidth ?? 0}px`;
        ghost.style.height = `${src?.offsetHeight ?? 0}px`;
        document.body.appendChild(ghost);
      }
      const ghost = byId('preorderGhost');
      if (ghost) {
        ghost.style.left = `${e.clientX + 10}px`;
        ghost.style.top = `${e.clientY + 10}px`;
      }
      // 贴近网格上下缘自动滚动(一次一步,move 事件天然节流)。
      const gr = grid.getBoundingClientRect();
      if (e.clientY < gr.top + 40) grid.scrollTop -= 14;
      else if (e.clientY > gr.bottom - 40) grid.scrollTop += 14;
      const ids = preorder.map((orig) => pagesState[orig]!.templateId);
      const rects: CellRect[] = preorderCells().map((el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, width: r.width, height: r.height };
      });
      d.gap = gapFromPointer(rects, legalGaps(ids, preorder, d.from), e.clientX, e.clientY);
      const bar = preorderInsertBar();
      if (d.gap === null) {
        bar.classList.remove('on');
      } else {
        // 插入条画在缝隙锚点:g<n 用第 g 格左缘,g=n 用末格右缘;viewport → grid 内容坐标。
        const at = rects[d.gap] ?? null;
        const prevCell = rects[d.gap - 1] ?? null;
        const edge = at ?? prevCell!;
        const xEdge = at ? at.left : prevCell!.left + prevCell!.width;
        bar.classList.add('on');
        bar.style.left = `${xEdge - gr.left + grid.scrollLeft - 2}px`;
        bar.style.top = `${edge.top - gr.top + grid.scrollTop}px`;
        bar.style.height = `${edge.height}px`;
      }
    };
    const onPreorderUp = () => {
      const d = preorderDrag;
      preorderDrag = null;
      byId('preorderGhost')?.remove();
      byId('preorderBar')?.remove();
      preorderCells().forEach((el) => el.classList.remove('preorder-dragging'));
      if (!preorder || !d || !d.lifted) return;
      if (d.gap !== null) {
        preorder = applyMove(preorder, d.from, d.gap);
        renderPreorderGrid();
      }
    };
```

import 行:`from './page-reorder'` 引入 `applyMove, buildInsertPermutation, gapFromPointer, isAnchoredTemplate, legalGaps, type CellRect`;确认 `pageBox` 已在 import(没有则从 `../templates/constants` 补)。

- [ ] **Step 5: 事件与注册接线**

- `preorderGrid` 三事件绑定,放在其它画布监听器集中绑定处(与既有 addEventListener 清理模式一致,组件卸载时移除):

```ts
    const preorderGridEl = byId('preorderGrid');
    preorderGridEl?.addEventListener('pointerdown', onPreorderDown as EventListener);
    preorderGridEl?.addEventListener('pointermove', onPreorderMove as EventListener);
    preorderGridEl?.addEventListener('pointerup', onPreorderUp as EventListener);
    preorderGridEl?.addEventListener('pointercancel', onPreorderUp as EventListener);
```

- actions 表(:5552 一带)加:

```ts
      openPageReorder,
      closePageReorder,
      confirmPageReorder: () => void confirmPageReorder(),
```

- `canvasScopes()`(:1417 一带)加 `add(byId('pageReorderModal'));`。
- 遮罩点击关闭注册表(:5584 的数组)加 `['pageReorderModal', closePageReorder]`。

- [ ] **Step 6: CSS(editor-port.css)**

删 `.pswap-sel` / `.pswap-dim` / `.page-swap-on` 三段(:1421-1427 一带,连同其注释);新增:

```css
/* ── 页序弹窗(2026-08-02):网格拖拽插入重排 ─────────────────────────────── */
.editor-port .preorder-card{ width:min(920px,92vw); max-height:86vh; display:flex; flex-direction:column; }
.editor-port .preorder-head{ position:relative; padding:20px 24px 10px; }
.editor-port .preorder-hint{ margin-top:4px; font-size:12.5px; color:var(--muted,#8a857a); }
.editor-port .preorder-grid{ position:relative; flex:1; overflow-y:auto; display:flex; flex-wrap:wrap; align-content:flex-start; gap:14px; padding:14px 24px; }
.editor-port .preorder-cell{ position:relative; flex:0 0 auto; border-radius:6px; overflow:hidden; box-shadow:0 1px 4px rgba(0,0,0,.14); cursor:grab; touch-action:none; }
.editor-port .preorder-cell.preorder-locked{ opacity:.45; cursor:default; }
.editor-port .preorder-cell.preorder-dragging{ opacity:.35; }
.editor-port .preorder-no{ position:absolute; bottom:4px; min-width:18px; padding:0 5px; border-radius:9px; background:rgba(0,0,0,.55); color:#fff; font-size:11px; line-height:18px; text-align:center; pointer-events:none; }
.editor-port .preorder-no-left{ left:4px; }
.editor-port .preorder-no-right{ right:4px; }
.editor-port .preorder-lock{ position:absolute; right:4px; bottom:4px; width:18px; height:18px; color:#fff; background:rgba(0,0,0,.55); border-radius:9px; padding:3px; pointer-events:none; }
.editor-port .preorder-lock svg{ display:block; width:100%; height:100%; }
.editor-port .preorder-bar{ position:absolute; width:4px; border-radius:2px; background:var(--accent,#c8a24a); opacity:0; pointer-events:none; transition:opacity .1s; }
.editor-port .preorder-bar.on{ opacity:1; }
.editor-port .preorder-foot{ display:flex; justify-content:flex-end; gap:10px; padding:12px 24px 20px; }
.editor-port .preorder-btn{ padding:9px 22px; border-radius:999px; font-size:13px; border:1px solid var(--bd,#ddd6c8); }
.editor-port .preorder-btn-primary{ background:var(--ink,#2f2b24); color:#fff; border-color:transparent; }
.editor-port .preorder-ghost{ position:fixed; z-index:1000; pointer-events:none; opacity:.85; border-radius:6px; overflow:hidden; box-shadow:0 8px 28px rgba(0,0,0,.3); }
```

(色值 token:实施时对照 editor-tokens.css 现有变量名,有同义 token 就用 token,没有才落字面量。)

- [ ] **Step 7: 手动验证 + 提交**

Run: `cd apps/web && pnpm tsx --test src/components/album/editor-v2/page-reorder.test.ts` → PASS;
`pnpm --filter @yujee/web typecheck 2>/dev/null || (cd apps/web && pnpm typecheck)` 若脚本存在则跑。
注意:`page-swap-wiring.test.ts` 此刻会红(桌面接线已删)——属预期,Task 4 删除该文件;本 Task 先不跑全量。

```bash
git add apps/web/src/components/album/editor-v2/EditorPort.tsx apps/web/src/components/album/editor-v2/editor-port.css apps/web/src/components/album/editor-v2/editor-coordinator.ts
git commit -m "feat(editor): 桌面页序弹窗(网格拖拽插入重排),点选交换模式退场"
```

---

### Task 3: 移动端 ReorderSheet + 主菜单入口 + 移动端旧模式退场

**Files:**
- Create: `apps/web/src/components/album/editor-v2/mobile/modals/ReorderSheet.tsx`
- Modify: `apps/web/src/components/album/editor-v2/mobile/modals/MoreSheet.tsx`
- Modify: `apps/web/src/components/album/editor-v2/mobile/MobileEditorRoot.tsx`
- Modify: `apps/web/src/components/album/editor-v2/mobile/MobileEditor.tsx`
- Modify: `apps/web/src/components/album/editor-v2/mobile/MobileStrip.tsx`
- Modify: `apps/web/src/components/album/editor-v2/mobile/mobile-editor.css`

**Interfaces:**
- Consumes: Task 1 全部导出;`pageFaceHTML`/`PageFaceCtx`(page-face)、`pageFolioInfos`(page-html-dom)、`SWAP_LONG_PRESS_MS`/`SWAP_LONG_PRESS_SLOP`(image-swap)、`ModalHost`、`ResolveImage`。
- Produces: `ReorderSheet` props `{ open, zh, pages, resolve, onClose, onCommit }`;MoreSheet 新 prop `onReorderPages: () => void`。

- [ ] **Step 1: 新建 `ReorderSheet.tsx`**

```tsx
'use client';

/* 页序弹窗(移动端,2026-08-02 设计)。网格缩略图长按拖拽插入重排;
   「完成」把工作序合成一个置换交给容器层落库,「取消」/遮罩直接丢弃。
   合法缝隙/置换/指针几何全部来自共享 page-reorder.ts;本组件只做 DOM:
   渲格子、量 rect、画插入条。子树守则:不碰 document,状态住本组件。
   弹窗壳走 ModalHost(.editor-port 宿主),网格样式直接命中桌面 preorder-*
   规则,移动端只在 mobile-editor.css 里做尺寸微调。 */

import { useEffect, useRef, useState } from 'react';

import type { EditorPage } from '../../../types';
import type { ResolveImage } from '../../../adapt-layout';
import { pageFolioInfos } from '../../../page-html-dom';
import { pageBox } from '../../../templates/constants';
import { pageFaceHTML } from '../../page-face';
import { SWAP_LONG_PRESS_MS, SWAP_LONG_PRESS_SLOP } from '../../image-swap';
import {
  applyMove,
  buildInsertPermutation,
  gapFromPointer,
  isAnchoredTemplate,
  legalGaps,
  type CellRect,
} from '../../page-reorder';
import { ModalHost } from './ModalHost';

const CELL_H = 108;

type Drag = {
  pointerId: number;
  from: number;
  startX: number;
  startY: number;
  timer: ReturnType<typeof setTimeout> | null;
  lifted: boolean;
  gap: number | null;
  x: number;
  y: number;
};

export function ReorderSheet({
  open,
  zh,
  pages,
  resolve,
  onClose,
  onCommit,
}: {
  open: boolean;
  zh: boolean;
  pages: EditorPage[];
  resolve: ResolveImage;
  onClose: () => void;
  /** 「完成」且非恒等时收到 perm[newIndex]=oldIndex;容器层负责乐观落库+回滚。 */
  onCommit: (permutation: number[]) => void;
}) {
  const [order, setOrder] = useState<number[]>([]);
  const [, bump] = useState(0); // 拖拽视觉态(lifted/gap)存 ref,变更时手动重渲
  const dragRef = useRef<Drag | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);

  // 只在打开那一刻建工作序;开着期间外部改书不重置,提交时按长度守卫。
  useEffect(() => {
    if (open) setOrder(pages.map((_, i) => i));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const ids = order.map((orig) => pages[orig]!.templateId);
  const folios = pageFolioInfos(ids);
  const drag = dragRef.current;

  const cellRects = (): CellRect[] =>
    [...(gridRef.current?.querySelectorAll<HTMLElement>('.preorder-cell') ?? [])].map((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    });

  const endDrag = (commitMove: boolean) => {
    const d = dragRef.current;
    if (!d) return;
    if (d.timer) clearTimeout(d.timer);
    dragRef.current = null;
    if (commitMove && d.lifted && d.gap !== null) {
      setOrder((cur) => applyMove(cur, d.from, d.gap!));
    } else {
      bump((n) => n + 1);
    }
  };

  const onDown = (pos: number) => (e: React.PointerEvent) => {
    if (dragRef.current || isAnchoredTemplate(pages[order[pos]!]!.templateId)) return;
    const d: Drag = {
      pointerId: e.pointerId,
      from: pos,
      startX: e.clientX,
      startY: e.clientY,
      timer: null,
      lifted: false,
      gap: null,
      x: e.clientX,
      y: e.clientY,
    };
    // 长按拾起(全仓触屏口径);期间移动超 slop 由 onMove 取消计时回落滚动。
    d.timer = setTimeout(() => {
      d.timer = null;
      d.lifted = true;
      gridRef.current?.setPointerCapture(d.pointerId);
      bump((n) => n + 1);
    }, SWAP_LONG_PRESS_MS);
    dragRef.current = d;
  };

  const onMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    d.x = e.clientX;
    d.y = e.clientY;
    if (!d.lifted) {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > SWAP_LONG_PRESS_SLOP) {
        if (d.timer) clearTimeout(d.timer);
        dragRef.current = null; // 是滚动,不是拖拽
      }
      return;
    }
    const grid = gridRef.current;
    if (grid) {
      const gr = grid.getBoundingClientRect();
      if (e.clientY < gr.top + 36) grid.scrollTop -= 12;
      else if (e.clientY > gr.bottom - 36) grid.scrollTop += 12;
    }
    d.gap = gapFromPointer(cellRects(), legalGaps(ids, order, d.from), e.clientX, e.clientY);
    bump((n) => n + 1);
  };

  const done = () => {
    if (order.length !== pages.length) {
      onClose(); // 开着期间书被外部改了:这次调整作废
      return;
    }
    const perm = buildInsertPermutation(order);
    onClose();
    if (perm) onCommit(perm);
  };

  // 插入条几何:g<n 用第 g 格左缘,g=n 用末格右缘(viewport → grid 内容坐标)。
  const barStyle = (() => {
    const d = dragRef.current;
    const grid = gridRef.current;
    if (!d?.lifted || d.gap === null || !grid) return null;
    const rects = cellRects();
    const at = rects[d.gap] ?? null;
    const prevCell = rects[d.gap - 1] ?? null;
    const edge = at ?? prevCell;
    if (!edge) return null;
    const gr = grid.getBoundingClientRect();
    return {
      left: (at ? at.left : prevCell!.left + prevCell!.width) - gr.left + grid.scrollLeft - 2,
      top: edge.top - gr.top + grid.scrollTop,
      height: edge.height,
    };
  })();

  return (
    <ModalHost open onClose={onClose} cardClassName="preorder-card" labelledBy="mReorderTitle" testId="reorder-sheet">
      <div className="preorder-head">
        <h3 id="mReorderTitle" className="font-display text-[17px] font-bold">{zh ? '调整页面顺序' : 'Reorder pages'}</h3>
        <p className="preorder-hint">{zh ? '长按拖动页面到新位置。封面、目录与封尾固定不动。' : 'Long-press and drag pages. Cover, contents and ending stay fixed.'}</p>
      </div>
      <div
        ref={gridRef}
        className="preorder-grid"
        onPointerMove={onMove}
        onPointerUp={() => endDrag(true)}
        onPointerCancel={() => endDrag(false)}
      >
        {order.map((orig, pos) => {
          const page = pages[orig]!;
          const anchored = isAnchoredTemplate(page.templateId);
          const box = pageBox(page.templateId);
          const w = Math.round((CELL_H * box.width) / box.height);
          const f = folios[pos]!;
          const lifted = drag?.lifted && drag.from === pos;
          return (
            <div
              key={orig}
              className={`preorder-cell${anchored ? ' preorder-locked' : ''}${lifted ? ' preorder-dragging' : ''}`}
              data-pos={pos}
              style={{ width: w, height: CELL_H }}
              onPointerDown={onDown(pos)}
              dangerouslySetInnerHTML={{
                __html:
                  pageFaceHTML(page, w, CELL_H, { folio: f.folio, folioSide: f.side, total: pages.length, resolve }) +
                  (anchored
                    ? '<span class="preorder-lock" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg></span>'
                    : f.folio === null
                      ? ''
                      : typeof f.folio === 'number'
                        ? `<span class="preorder-no preorder-no-${f.side}">${f.folio}</span>`
                        : `<span class="preorder-no preorder-no-left">${f.folio.left}</span><span class="preorder-no preorder-no-right">${f.folio.right}</span>`),
              }}
            />
          );
        })}
        {barStyle && <div className="preorder-bar on" style={barStyle} />}
        {drag?.lifted && (
          <div
            className="preorder-ghost"
            style={{ left: drag.x + 8, top: drag.y + 8, width: 72, height: CELL_H * 0.66 }}
            dangerouslySetInnerHTML={{
              __html: pageFaceHTML(pages[order[drag.from]!]!, 72, Math.round(CELL_H * 0.66), {
                folio: null,
                folioSide: 'left',
                total: pages.length,
                resolve,
              }),
            }}
          />
        )}
      </div>
      <div className="preorder-foot">
        <button className="preorder-btn" onClick={onClose} data-testid="m-reorder-cancel">{zh ? '取消' : 'Cancel'}</button>
        <button className="preorder-btn preorder-btn-primary" onClick={done} data-testid="m-reorder-done">{zh ? '完成' : 'Done'}</button>
      </div>
    </ModalHost>
  );
}
```

(注:`preorder-ghost` 桌面版是 `position:fixed` 挂 body;移动端不碰 document,挂在 grid 内。mobile-editor.css 里为 `.mobile-modal-host .preorder-ghost` 覆写 `position:fixed`——fixed 相对 viewport,不需要 body 挂载,规则照常生效。)

- [ ] **Step 2: MoreSheet 加入口**

props 增加 `onReorderPages: () => void;`(带 jsdoc「页序弹窗入口(2026-08-02):打开 ReorderSheet」),在「全书照片风格」按钮**之前**插入:

```tsx
        <button className="export-opt" onClick={onReorderPages} data-testid="more-reorder">
          <svg {...stroke}>
            <polyline points="17 1 21 5 17 9" />
            <path d="M3 11V9a4 4 0 0 1 4-4h14" />
            <polyline points="7 23 3 19 7 15" />
            <path d="M21 13v2a4 4 0 0 1-4 4H3" />
          </svg>
          <span>{zh ? '调整页面顺序' : 'Reorder pages'}</span>
        </button>
```

- [ ] **Step 3: MobileEditorRoot 接线 + 退场**

删除(:468-531 一带):`pageSwapOn`/`pageSwapSel` 两个 useState、`onPageSwapToggle`/`pageSwapTargetUnit`/`pageSwapFaceState`/`commitPageSwap`/`onPageSwapPick`,`page-swap` import 整行,以及传给 `<MobileEditor>` 的 `pageSwap=...` / `onPageSwapToggle=...` 两行(:786-787)。

新增(原位置):

```tsx
  // ── 页序弹窗(2026-08-02 设计):主菜单入口,ReorderSheet 里拖拽插入重排。──
  // 「完成」才到这里:乐观重排 + 原子 reorder,失败回滚 + toast,与桌面同口径。
  const [reorderOpen, setReorderOpen] = useState(false);
  const commitReorder = (perm: number[]) => {
    const prev = pages;
    setPages(perm.map((oldIdx, newIdx) => ({ ...prev[oldIdx]!, pageIndex: newIdx })));
    void fetch(`/api/v1/albums/${detail.album.id}/pages/reorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permutation: perm }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`reorder ${res.status}`);
      })
      .catch(() => {
        setPages(prev);
        say(zh ? '页序没有存上，已恢复原顺序，请重试' : 'Order not saved; restored — please retry');
      });
  };
```

MoreSheet 调用处(:946)加 `onReorderPages={() => { setMoreOpen(false); setReorderOpen(true); }}`;其后平级渲染:

```tsx
    <ReorderSheet
      open={reorderOpen}
      zh={zh}
      pages={pages}
      resolve={resolveThumb}
      onClose={() => setReorderOpen(false)}
      onCommit={commitReorder}
    />
```

import `{ ReorderSheet } from './modals/ReorderSheet'`。

- [ ] **Step 4: MobileEditor / MobileStrip 退场**

- `MobileEditor.tsx`:删 props `pageSwap` / `onPageSwapToggle`(声明 :89-95、解构 :154、按钮 :600-612、`swap={pageSwap}` :647);`MobileStrip` 调用只剩原有浏览 props。
- `MobileStrip.tsx`:删 `swap` prop(声明 :34-40、解构、面渲染里的 `data-pswap`/onPick 分支与 stopPropagation 逻辑)。
- `mobile-editor.css`:删 `.mstrip-face[data-pswap]` 三段(:634-648 一带);新增:

```css
/* 页序弹窗(2026-08-02):壳/网格样式命中桌面 preorder-* 规则,这里只做移动端微调。 */
.mobile-modal-host .preorder-card{ width:min(560px,94vw); max-height:82dvh; }
.mobile-modal-host .preorder-grid{ gap:10px; padding:12px 14px; }
.mobile-modal-host .preorder-ghost{ position:fixed; z-index:1000; pointer-events:none; opacity:.85; border-radius:6px; overflow:hidden; box-shadow:0 8px 28px rgba(0,0,0,.3); }
```

- [ ] **Step 5: 手动验证 + 提交**

Run: `cd apps/web && pnpm tsx --test src/components/album/editor-v2/page-reorder.test.ts "src/components/album/editor-v2/mobile/**/*.test.ts"`
Expected: page-reorder PASS;mobile 既有测试若有 pin 住 pageSwap 接线的用例会红——把这些用例连同旧接线一起删(它们守卫的行为已退场),其余必须绿。

```bash
git add -A apps/web/src/components/album/editor-v2/mobile apps/web/src/components/album/editor-v2/page-reorder.ts
git commit -m "feat(mobile): 页序弹窗 ReorderSheet(主菜单入口,长按拖拽插入),预览栏交换退场"
```

---

### Task 4: page-swap 三件套删除 + 新接线守卫 + 全量验证

**Files:**
- Delete: `apps/web/src/components/album/editor-v2/page-swap.ts`、`page-swap.test.ts`、`page-swap-wiring.test.ts`
- Create: `apps/web/src/components/album/editor-v2/page-reorder-wiring.test.ts`
- Modify: 视 `pnpm docs:check` 输出,推进相关 README 的 `checked-at`

**Interfaces:**
- Consumes: Task 2/3 落地后的源码形态(靠 source-regex pin)。
- Produces: 无(纯守卫)。

- [ ] **Step 1: 删除三件套并确认零引用**

```bash
git rm apps/web/src/components/album/editor-v2/page-swap.ts apps/web/src/components/album/editor-v2/page-swap.test.ts apps/web/src/components/album/editor-v2/page-swap-wiring.test.ts
grep -rn "page-swap\|pageSwap\|pswap\|PageSwapUnit" apps/web/src --include='*.ts*' --include='*.css'
```

Expected: grep 只剩 `data-i18n-tip="pageSwap"` 与 coordinator 里 `pageSwap` tip 键(tooltip 文案沿用);其余零命中。有残留就回去清。

- [ ] **Step 2: 写新接线守卫 `page-reorder-wiring.test.ts`**

```ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

/* 页序弹窗(2026-08-02 设计)的接线守卫。纯逻辑对错在 page-reorder.test.ts;
   这里 pin 接线上的共存条件:
     · 合法缝隙/置换必须来自共享 page-reorder.ts,两端不许各写一套
     · 「完成」是唯一的 reorder 发射点(每端一个 fetch 调用点),恒等短路零请求
     · 手势口径:桌面超 slop 立即拾起,移动端长按 SWAP_LONG_PRESS_MS 拾起
     · 旧点选式交换(page-swap/pswap)不复存在 */

const here = dirname(fileURLToPath(import.meta.url));
const read = (...p: string[]) => readFileSync(join(here, ...p), 'utf8');

const editor = read('EditorPort.tsx');
const desktopCss = read('editor-port.css');
const mobileRoot = read('mobile', 'MobileEditorRoot.tsx');
const mobileEditor = read('mobile', 'MobileEditor.tsx');
const mobileStrip = read('mobile', 'MobileStrip.tsx');
const mobileCss = read('mobile', 'mobile-editor.css');
const moreSheet = read('mobile', 'modals', 'MoreSheet.tsx');
const reorderSheet = read('mobile', 'modals', 'ReorderSheet.tsx');

test('两端合法缝隙/置换都来自共享 page-reorder', () => {
  assert.match(editor, /from '\.\/page-reorder'/);
  assert.match(reorderSheet, /from '\.\.\/\.\.\/page-reorder'/);
  for (const src of [editor, reorderSheet]) {
    assert.match(src, /legalGaps\(/);
    assert.match(src, /applyMove\(/);
    assert.match(src, /buildInsertPermutation\(/);
    assert.match(src, /gapFromPointer\(/);
  }
});

test('桌面:入口按钮开弹窗,完成才发一次 reorder,恒等短路', () => {
  assert.match(editor, /data-action="openPageReorder"/);
  assert.match(editor, /openPageReorder,/);
  assert.match(editor, /confirmPageReorder: \(\) => void confirmPageReorder\(\)/);
  const fetches = editor.match(/pages\/reorder/g) ?? [];
  assert.equal(fetches.length, 1, '桌面只允许 confirmPageReorder 一个发射点');
  assert.match(editor, /if \(!perm\) return; \/\/ 恒等:零请求/);
});

test('移动端:主菜单入口 → ReorderSheet,完成才发一次 reorder', () => {
  assert.match(moreSheet, /data-testid="more-reorder"/);
  assert.match(moreSheet, /onReorderPages/);
  assert.match(mobileRoot, /<ReorderSheet/);
  const fetches = mobileRoot.match(/pages\/reorder/g) ?? [];
  assert.equal(fetches.length, 1, '移动端只允许 commitReorder 一个发射点');
  assert.match(reorderSheet, /if \(perm\) onCommit\(perm\)/, '恒等不上报');
});

test('手势口径:桌面超 slop 立即拾起,移动端长按拾起、动了回落滚动', () => {
  assert.match(editor, /SWAP_LONG_PRESS_SLOP\) return;/);
  assert.doesNotMatch(editor, /preorder[\s\S]{0,400}?SWAP_LONG_PRESS_MS/, '桌面弹窗无长按仲裁');
  assert.match(reorderSheet, /SWAP_LONG_PRESS_MS/);
  assert.match(reorderSheet, /SWAP_LONG_PRESS_SLOP/);
});

test('失败回滚:两端提交失败都回滚本地并提示', () => {
  assert.match(editor, /pageReorderFailed/);
  assert.match(mobileRoot, /页序没有存上/);
});

test('旧点选式交换不复存在', () => {
  for (const [name, src] of [
    ['EditorPort', editor],
    ['editor-port.css', desktopCss],
    ['MobileEditorRoot', mobileRoot],
    ['MobileEditor', mobileEditor],
    ['MobileStrip', mobileStrip],
    ['mobile-editor.css', mobileCss],
  ] as const) {
    assert.doesNotMatch(src, /pswap/, `${name} 不得残留 pswap`);
    assert.doesNotMatch(src, /page-swap'/, `${name} 不得再引 page-swap 模块`);
    assert.doesNotMatch(src, /PageSwapUnit/, `${name} 不得残留交换单位类型`);
  }
});

test('锚定页:两端格子都锁(不可拖起)', () => {
  assert.match(editor, /preorder-locked/);
  assert.match(reorderSheet, /preorder-locked/);
  assert.match(editor, /isAnchoredTemplate\(/);
  assert.match(reorderSheet, /isAnchoredTemplate\(/);
});
```

- [ ] **Step 3: 全量验证**

Run: `pnpm --filter @yujee/web test`
Expected: 全绿(注意仓根 test 撞第一个失败包就中断的坑,这里只跑 web 包)。
再跑 `pnpm typecheck`——若 docs:check 报 `paths` 覆盖到本次改动的文档,回头核对该文档内容(过时就改),把 `checked-at` 推进到本次提交。

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(editor): page-swap 三件套退场,新接线守卫 page-reorder-wiring"
```

---

## Self-Review 结论(计划作者自查)

- 规格覆盖:设计 §一(零后端)无任务——本来就零改动;§二→Task 1;§3a→Task 2;§3b→Task 3;§四→Task 2/3;§五→Task 2/3/4;§六→Task 1/4。
- 类型一致:`CellRect`/`legalGaps(templateIds, order, from)`/`applyMove(order, from, gap)`/`buildInsertPermutation(order)` 在 Task 1 定义、Task 2/3/4 按同名同参消费;`perm[newIndex]=oldIndex` 应用公式两端一致(`perm.map((oldIdx, newIdx) => ({ ...prev[oldIdx]!, pageIndex: newIdx }))`)。
- 已知妥协(实施时留意):桌面 `faceCtx(page, resolveImage)` 给的是**当前实际页序**的 folio,弹窗网格要的是**工作序** folio——Task 2 Step 4 的 `renderPreorderGrid` 里已用 `pageFolioInfos(ids)` 按工作序另算并以角标呈现,`pageFaceHTML` 内部烙的旧页签在缩略尺寸下不可辨(设计 §三已拍板)。若实施时发现视觉冲突,把 `faceCtx` 换成 `{ folio: null, folioSide: 'left', total, resolve: resolveImage }` 即可(角标是唯一页码来源)。
