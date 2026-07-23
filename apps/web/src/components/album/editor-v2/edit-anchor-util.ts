// Element-toolbar anchor survival across a repaint. Split out of EditorPort.tsx
// so the identity/decision logic is unit-testable without a DOM (this repo has no
// jsdom harness — tests run under `tsx --test`).
//
// ── The bug this fixes ──
// `paintEl` repaints a page with `el.innerHTML = faceHTML(...)`, replacing every
// node inside it. `reattachImgEdit()` already re-binds the image-edit overlay to
// the fresh nodes, but the element toolbar's `editBarAnchor` had no equivalent,
// so after any repaint (an AI page write, an inline text commit, a template swap)
// it kept pointing at a node that had left the document.
//
// That failure is SILENT, which is what made it hard to spot: `Element.matches()`
// evaluates a self-only selector like `[data-editable]:not(img)` just fine on a
// detached node, so `selectedTextTargets()` still handed back the dead anchor and
// every colour/font/size click wrote `el.style.*` into a node nobody can see —
// no console error, no network request, no visual change. The toolbar itself
// stayed visible (its own `show` class is untouched by a repaint), so the UI read
// as "the tool opens but the next level does nothing", and re-selecting the text
// silently fixed it.
//
// An anchor's identity across a repaint is (page index, text key): `paintEl`
// re-emits `[data-text-key]` slots and re-marks them `[data-editable]`, so the
// same slot on the same page is the same logical anchor even though it is a new
// node. A keyless anchor is the page host itself (the 'page' toolbar group,
// whose anchor is the `[data-page-index]` element).

/** Identity of an anchored node, stable across repaints. `textKey: null` = the page host. */
export interface EditAnchorId {
  pageIndex: number;
  textKey: string | null;
}

/** Which toolbar group the anchor belongs to — 'page' anchors the page host itself. */
export type EditAnchorKind = 'text' | 'page';

/**
 * Identity of the currently anchored node, or `null` when it cannot be re-found
 * after a repaint — in which case the caller must CLEAR the selection rather than
 * keep (or half-restore) a dead anchor. That happens when:
 *
 *  - there is no usable page index, or
 *  - a 'text' anchor carries no `data-text-key`. Legacy templates mark text
 *    editable by class (`.ch-mark` / `.photo .cap`), and `markEditableTextKeys`
 *    can only key the ones whose content matches a `textsJson` entry. An unkeyed
 *    text node has no stable identity, and falling back to the page host would be
 *    worse than clearing: the text tools would look re-armed while pointing at an
 *    element they can never style.
 */
export function editAnchorId(
  pageIndex: string | undefined,
  textKey: string | undefined,
  kind: EditAnchorKind,
): EditAnchorId | null {
  if (pageIndex === undefined || pageIndex === '') return null;
  const idx = Number(pageIndex);
  if (!Number.isInteger(idx)) return null;
  if (kind === 'page') return { pageIndex: idx, textKey: null };
  if (textKey === undefined || textKey === '') return null;
  return { pageIndex: idx, textKey };
}

// Attribute selectors take a QUOTED value verbatim, so bracket-path slot ids
// (`cells[0].text`, `folio[1]`) need no CSS.escape — only the two characters that
// would terminate or escape the quoted string itself.
function quoteAttrValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** CSS selector that re-finds the same logical anchor in the repainted DOM. */
export function editAnchorSelector(id: EditAnchorId): string {
  const page = `[data-page-index="${id.pageIndex}"]`;
  if (id.textKey === null) return page;
  return `${page} [data-text-key="${quoteAttrValue(id.textKey)}"]`;
}

export type EditAnchorAction<T> =
  | { type: 'keep' }
  | { type: 'reattach'; node: T }
  | { type: 'clear' };

/**
 * Decide what to do with the toolbar anchor after a repaint.
 *
 * - nothing selected, or the anchor is still in the document → `keep` (and the
 *   lookup is never run, so a live toolbar costs no DOM query per repaint)
 * - detached but the slot came back → `reattach` to the fresh node
 * - detached and the slot is gone (template swapped, slot dropped by an AI edit)
 *   → `clear`, so the toolbar is torn down instead of floating over nothing
 */
export function resolveEditAnchor<T>(
  anchor: T | null,
  isConnected: boolean,
  findFresh: () => T | null,
): EditAnchorAction<T> {
  if (anchor === null || isConnected) return { type: 'keep' };
  const fresh = findFresh();
  return fresh === null ? { type: 'clear' } : { type: 'reattach', node: fresh };
}
