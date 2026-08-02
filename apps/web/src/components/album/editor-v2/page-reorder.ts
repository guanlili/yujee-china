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
