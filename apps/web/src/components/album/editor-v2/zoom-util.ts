// Pure zoom math for the editor canvas, split out so it can be unit-tested
// without importing EditorPort.tsx (which side-effect-imports CSS + the whole
// React/template tree, neither of which loads under `tsx --test`).

// Clamp a candidate zoom level into [min, max], rounded to 2 decimals (the zoom
// step is 0.25). Zooming out past the floor stops at `min` — it must never fall
// below and trigger the "整本概览" jump that hides the spread (issue #157).
export function clampZoom(next: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(next * 100) / 100));
}

// What paintEl should do for a target cell, given its measured layout state.
// Split out so the defer/skip branching is unit-testable without a DOM.
//
// - 'skip'  : a `display:none` ancestor hides the element (offsetParent === null,
//             these page/thumb cells are never position:fixed). It can't gain a
//             box until shown again, so deferring would spin a per-frame rAF loop
//             forever — the regression the issue #157 fix introduced. The element
//             is repainted when it becomes visible (overview-exit / repaintBook),
//             so dropping this paint is safe.
// - 'defer' : laid out but not yet measured (0×0 while visible). One rAF retry,
//             capped, so it can't recurse unbounded even if it never measures.
// - 'paint' : has real dimensions — bake the page now.
export type PaintAction = 'skip' | 'defer' | 'paint';

export function paintDecision(
  hidden: boolean,
  clientWidth: number,
  clientHeight: number,
  attempt: number,
  maxAttempts: number,
): PaintAction {
  if (hidden) return 'skip';
  if (!clientWidth || !clientHeight) return attempt >= maxAttempts ? 'skip' : 'defer';
  return 'paint';
}
