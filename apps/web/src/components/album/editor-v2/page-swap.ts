/* ════════════════════════════════════════════════════════════════════════════
   page-swap —— 整页交换的纯逻辑层。桌面画布与移动端预览栏共用。
   (2026-08-01 设计:docs/specs/2026-08-01-swap-gesture-and-page-swap-design.md)

   ── 交换单位,而不是任意重排 ──────────────────────────────────────────────
   左右页归属由 placePages 顺序贪心推导(spreads.ts 只是转形状),页在数组里挪动
   会让下游全体翻面 —— 对装订成册的实物,「只动了一页,后面全翻面」是不可接受的
   意外(与拆页限奇数同一个理由,见 2026-07-30-split-delete-page-design.md)。
   所以这里只提供**块对调**:
     · 单页 ↔ 单页:1 条记录原地对调,下游纹丝不动;
     · 大页 ↔ 大页:同上;
     · 大页 ↔ 对页:1 条换 2 条,块整体互换后中间各 pair 成员依旧相邻(贪心扫描
       不看奇偶位,只看顺序),配对不乱 —— 「大页只能两页两页一起换」的结构学依据。
     · 单页 ↔ 大页:禁止,那等于净增/净减一个页位,下游全翻面。
   cover / toc / ending 独占半个跨页且锚定书的头尾,不参与交换。

   ── 交换搬整条记录 ────────────────────────────────────────────────────────
   与图片交换(image-swap.ts 只动 imagesJson)刻意不同:整页交换是页的**位置**变了,
   页内一切(templateId/images/texts/imagePos/html)原样跟着走。落库走原子的
   pages/reorder 端点,置换语义 perm[newIndex] = oldIndex。

   全部纯函数、零 DOM:node 直测,移动端「不许碰 document」的子树可以照用。
   pageIndex 与数组下标恒等(0..n-1 连续,类型注释见 types.ts),这里统一用下标。
   ════════════════════════════════════════════════════════════════════════════ */

import { getTemplate } from '@yujee/contracts/templates';
import { buildSpreads } from '../spreads';
import type { EditorPage } from '../types';

/** 一个可交换的页记录块:单页 1 条 / 大页 1 条 / 对页相邻 2 条(升序)。 */
export type PageSwapUnit = { kind: 'single' | 'full' | 'pair'; indices: number[] };

/** 这一页自身作为交换单位:单页/大页;cover·toc·ending 或越界 → null(不可动)。 */
export function swapUnitOfPage(pages: EditorPage[], pageArrayIndex: number): PageSwapUnit | null {
  const page = pages[pageArrayIndex];
  if (!page) return null;
  const category = getTemplate(page.templateId)?.category;
  if (category === 'cover' || category === 'toc' || category === 'ending') return null;
  const spreads = buildSpreads(pages);
  const spread = spreads.find((s) =>
    s.kind === 'full' ? s.page === pageArrayIndex : s.left === pageArrayIndex || s.right === pageArrayIndex,
  );
  if (!spread) return null;
  if (spread.kind === 'full') return { kind: 'full', indices: [pageArrayIndex] };
  return { kind: 'single', indices: [pageArrayIndex] };
}

/** 这一页所在对页的整体单元(两侧齐全才算;solo/full/单边尾巴 → null)。
 *  只在「选中了大页、找它的落点」时用:大页只能和**完整**的一对换 —— 单边 pair
 *  的那半空白不是可搬的记录,换过去会凭空多出一个页位。 */
export function pairUnitOfPage(pages: EditorPage[], pageArrayIndex: number): PageSwapUnit | null {
  if (swapUnitOfPage(pages, pageArrayIndex) === null) return null;
  const spreads = buildSpreads(pages);
  const spread = spreads.find(
    (s) => s.kind === 'pair' && (s.left === pageArrayIndex || s.right === pageArrayIndex),
  );
  if (!spread || spread.kind !== 'pair') return null;
  if (spread.left === null || spread.right === null) return null;
  return { kind: 'pair', indices: [spread.left, spread.right] };
}

/** 合法组合:单↔单、大↔大、大↔对页(方向无关)。indices 相交或同一单元 → false。
 *  pair↔pair 不做:等价于两次单↔单,不值得多一条规则。 */
export function canSwapUnits(a: PageSwapUnit, b: PageSwapUnit): boolean {
  if (a.indices.some((i) => b.indices.includes(i))) return false;
  if (a.kind === 'single' && b.kind === 'single') return true;
  if (a.kind === 'full' && b.kind === 'full') return true;
  if (a.kind === 'full' && b.kind === 'pair') return true;
  if (a.kind === 'pair' && b.kind === 'full') return true;
  return false;
}

/**
 * 两个块对调后的完整置换,perm[newIndex] = oldIndex(pages/reorder 端点的 body 语义)。
 * 大↔对页时块长不等(1↔2),夹在中间的页整体平移一位 —— 置换如实给出,调用方
 * 不需要关心哪几页动了。非法组合返回 null。
 */
export function buildSwapPermutation(
  pageCount: number,
  a: PageSwapUnit,
  b: PageSwapUnit,
): number[] | null {
  if (!canSwapUnits(a, b)) return null;
  const [lo, hi] = a.indices[0]! < b.indices[0]! ? [a, b] : [b, a];
  const loStart = lo.indices[0]!;
  const loEnd = lo.indices[lo.indices.length - 1]!;
  const hiStart = hi.indices[0]!;
  const hiEnd = hi.indices[hi.indices.length - 1]!;
  if (hiEnd >= pageCount || loEnd < 0) return null;
  const range = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, i) => from + i);
  // 五段重拼:前缀 + 高块 + 中间 + 低块 + 后缀。
  return [
    ...range(0, loStart - 1),
    ...hi.indices,
    ...range(loEnd + 1, hiStart - 1),
    ...lo.indices,
    ...range(hiEnd + 1, pageCount - 1),
  ];
}
