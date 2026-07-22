import { getTemplate } from '@yujee/contracts/templates';
import { placePages } from './page-layout';
import type { EditorPage } from './types';

// Canvas model (docs/agent/template-redesign.md §4): every page lives on one
// canvas, but the head and tail each hold a solo single-page slot. cover pages
// and ending pages sit alone (outside the spread-pairing system); interior pages
// (toc + body) pair two-up. An odd trailing interior page gets a blank facing
// half. A spread holds array indices into `pages` (null = a blank half).
//
// 配对走查本身住在 page-layout.ts(唯一真相),这里只负责把它转成 Spread 形状。

export interface Spread {
  left: number | null;
  right: number | null;
  /** 双宽(spread)模板占满整个跨页时,它的页数组下标;此时 left/right 恒为 null。 */
  full?: number;
}

// cover / ending sit as solo pages; everything else (toc + interior body) pairs
// two-up. We collapse the category to that solo-vs-paired distinction here.
// Exported so the editor can label a spread by what it holds (封面/封底/内页)。
export function pageSlot(page: EditorPage): 'cover' | 'interior' | 'ending' {
  const category = getTemplate(page.templateId)?.category;
  if (category === 'cover') return 'cover';
  if (category === 'ending') return 'ending';
  return 'interior';
}

export function buildSpreads(pages: EditorPage[]): Spread[] {
  const placements = placePages(pages.map((p) => p.templateId));
  const spreads: Spread[] = [];
  placements.forEach((placement, pageArrayIndex) => {
    while (spreads.length <= placement.spreadIndex) {
      spreads.push({ left: null, right: null });
    }
    const spread = spreads[placement.spreadIndex]!;
    if (placement.side === 'both') spread.full = pageArrayIndex;
    else if (placement.side === 'left') spread.left = pageArrayIndex;
    else spread.right = pageArrayIndex;
  });
  return spreads;
}

// Which spread (index) holds a given page array index; -1 if not found.
export function spreadIndexOfPage(spreads: Spread[], pageArrayIndex: number): number {
  return spreads.findIndex(
    (s) => s.left === pageArrayIndex || s.right === pageArrayIndex || s.full === pageArrayIndex,
  );
}

// A *solo* spread is a true single-page leaf: a cover (recto) or an ending
// (verso) that buildSpreads pushed on its own, with the facing half blank.
// The preview renders these as one centered page — no blank facing half, no
// center spine.
//
// IMPORTANT: an interior odd-trailing page also lands as { left: i, right: null }
// (same shape as an ending), but it is NOT solo — that blank half is normal
// spread whitespace and must stay. So we never key off "a null half"; we key off
// the *category* of the single occupied page. Only category cover/ending qualify.
export function isSoloSpread(spread: Spread | undefined, pages: EditorPage[]): boolean {
  if (!spread) return false;
  // 双宽页占满整个跨页,不是「单页 leaf」—— 它要保持双页宽的容器。
  if (spread.full != null) return false;
  const hasLeft = spread.left != null;
  const hasRight = spread.right != null;
  // Exactly one half occupied — a paired interior spread is never solo.
  if (hasLeft === hasRight) return false;
  const idx = hasLeft ? spread.left! : spread.right!;
  const page = pages[idx];
  if (!page) return false;
  const slot = pageSlot(page);
  return slot === 'cover' || slot === 'ending';
}
