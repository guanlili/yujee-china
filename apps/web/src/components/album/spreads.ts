import { getTemplate } from '@yujee/contracts/templates';
import type { EditorPage } from './types';

// Canvas model (docs/agent/template-redesign.md §4): every page lives on one
// canvas, but the head and tail each hold a solo single-page slot. cover pages
// and ending pages sit alone (outside the spread-pairing system); interior pages
// (toc + body) pair two-up. An odd trailing interior page gets a blank facing
// half. A spread holds array indices into `pages` (null = a blank half).
//
// TODO(phase-2b): honour forced pairing (template.pairing) once any template
// declares it — today none do, so interior simply pairs in order.

export interface Spread {
  left: number | null;
  right: number | null;
}

// cover / ending sit as solo pages; everything else (toc + interior body) pairs
// two-up. We collapse the category to that solo-vs-paired distinction here.
function slotOf(page: EditorPage): 'cover' | 'interior' | 'ending' {
  const category = getTemplate(page.templateId)?.category;
  if (category === 'cover') return 'cover';
  if (category === 'ending') return 'ending';
  return 'interior';
}

export function buildSpreads(pages: EditorPage[]): Spread[] {
  const spreads: Spread[] = [];
  let pendingLeft: number | null = null;

  const flushPending = () => {
    if (pendingLeft !== null) {
      spreads.push({ left: pendingLeft, right: null });
      pendingLeft = null;
    }
  };

  pages.forEach((page, i) => {
    const slot = slotOf(page);
    if (slot === 'cover' || slot === 'ending') {
      flushPending();
      // cover opens as a right-hand recto; ending closes as a left-hand verso.
      spreads.push(slot === 'cover' ? { left: null, right: i } : { left: i, right: null });
      return;
    }
    if (pendingLeft === null) {
      pendingLeft = i;
    } else {
      spreads.push({ left: pendingLeft, right: i });
      pendingLeft = null;
    }
  });
  flushPending();

  return spreads;
}

// Which spread (index) holds a given page array index; -1 if not found.
export function spreadIndexOfPage(spreads: Spread[], pageArrayIndex: number): number {
  return spreads.findIndex(
    (s) => s.left === pageArrayIndex || s.right === pageArrayIndex,
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
  const hasLeft = spread.left != null;
  const hasRight = spread.right != null;
  // Exactly one half occupied — a paired interior spread is never solo.
  if (hasLeft === hasRight) return false;
  const idx = hasLeft ? spread.left! : spread.right!;
  const page = pages[idx];
  if (!page) return false;
  const slot = slotOf(page);
  return slot === 'cover' || slot === 'ending';
}
