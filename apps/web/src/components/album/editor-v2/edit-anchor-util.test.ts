import assert from 'node:assert/strict';
import test from 'node:test';
import {
  editAnchorId,
  editAnchorSelector,
  resolveEditAnchor,
  type EditAnchorId,
} from './edit-anchor-util';

// ── Why this module exists ──
// `paintEl` repaints a page with `el.innerHTML = faceHTML(...)`, so every node
// inside is replaced. The image selection already survives that via
// `reattachImgEdit()`; the element toolbar's `editBarAnchor` did NOT, and a
// detached anchor is silent: `el.matches('[data-editable]')` still returns true
// on a node that left the document, so every font/colour/size click wrote styles
// into a node nobody can see — no error, no request, no visible change.
// These helpers are the pure half of the fix: identity of an anchor, the selector
// that re-finds it in the fresh DOM, and the keep/reattach/clear decision.

// ── editAnchorId: what identifies an anchor across a repaint ──

test('editAnchorId identifies a text anchor by page index + text key', () => {
  assert.deepEqual(editAnchorId('3', 'title', 'text'), { pageIndex: 3, textKey: 'title' });
});

test('editAnchorId identifies a page anchor as the page host itself', () => {
  assert.deepEqual(editAnchorId('0', undefined, 'page'), { pageIndex: 0, textKey: null });
});

test('editAnchorId ignores a stray text key on a page anchor', () => {
  // The 'page' toolbar group anchors on the [data-page-index] host; whatever key
  // that element happens to carry must not turn it into a text lookup.
  assert.deepEqual(editAnchorId('4', 'title', 'page'), { pageIndex: 4, textKey: null });
});

test('editAnchorId gives up on a text anchor that has no text key', () => {
  // Legacy templates mark text editable by class (.ch-mark / .photo .cap); if
  // markEditableTextKeys could not match one to a textsJson entry it carries no
  // data-text-key, so there is nothing to re-find it by after a repaint. Returning
  // null makes the caller CLEAR the toolbar — falling back to the page host would
  // silently re-anchor the text tools onto a node they can never style.
  assert.equal(editAnchorId('2', undefined, 'text'), null);
  assert.equal(editAnchorId('2', '', 'text'), null);
});

test('editAnchorId returns null when the page index is missing or not a number', () => {
  assert.equal(editAnchorId(undefined, 'title', 'text'), null);
  assert.equal(editAnchorId('', 'title', 'text'), null);
  assert.equal(editAnchorId('abc', 'title', 'text'), null);
});

// ── editAnchorSelector: re-find the same node in the repainted DOM ──

test('editAnchorSelector targets the page host when there is no text key', () => {
  assert.equal(editAnchorSelector({ pageIndex: 3, textKey: null }), '[data-page-index="3"]');
});

test('editAnchorSelector targets the text slot inside its page', () => {
  assert.equal(
    editAnchorSelector({ pageIndex: 2, textKey: 'title' }),
    '[data-page-index="2"] [data-text-key="title"]',
  );
});

test('editAnchorSelector keeps bracket-path slot ids usable as a selector', () => {
  // Real slot ids carry bracket paths (`cells[0].text`, `folio[1]`). An attribute
  // selector with a QUOTED value takes them verbatim — no CSS.escape needed (this
  // module stays DOM-free so it is unit-testable).
  assert.equal(
    editAnchorSelector({ pageIndex: 1, textKey: 'cells[0].text' }),
    '[data-page-index="1"] [data-text-key="cells[0].text"]',
  );
});

test('editAnchorSelector escapes quotes and backslashes so the selector cannot break', () => {
  assert.equal(
    editAnchorSelector({ pageIndex: 0, textKey: 'a"b\\c' }),
    '[data-page-index="0"] [data-text-key="a\\"b\\\\c"]',
  );
});

// ── resolveEditAnchor: keep / reattach / clear ──

test('resolveEditAnchor keeps a live anchor and never looks anything up', () => {
  let lookups = 0;
  const anchor = { id: 'live' };
  const action = resolveEditAnchor(anchor, true, () => {
    lookups++;
    return null;
  });
  assert.deepEqual(action, { type: 'keep' });
  assert.equal(lookups, 0, 'a connected anchor must not trigger a DOM query');
});

test('resolveEditAnchor reattaches a detached anchor to the fresh node', () => {
  const stale = { id: 'stale' };
  const fresh = { id: 'fresh' };
  const action = resolveEditAnchor(stale, false, () => fresh);
  assert.deepEqual(action, { type: 'reattach', node: fresh });
});

test('resolveEditAnchor clears when the slot is gone after the repaint', () => {
  // An AI edit can swap the template or drop the slot entirely. Leaving the
  // toolbar up would show a live-looking toolbar wired to nothing — the exact
  // bug this module fixes. Tear it down instead.
  const stale = { id: 'stale' };
  const action = resolveEditAnchor(stale, false, () => null);
  assert.deepEqual(action, { type: 'clear' });
});

test('resolveEditAnchor is a no-op when nothing is selected', () => {
  const action = resolveEditAnchor(null, false, () => ({ id: 'fresh' }));
  assert.deepEqual(action, { type: 'keep' });
});

// ── the round trip the fix relies on ──

test('a text anchor id survives the id → selector round trip', () => {
  const id = editAnchorId('7', 'cells[2].text', 'text') as EditAnchorId;
  assert.equal(
    editAnchorSelector(id),
    '[data-page-index="7"] [data-text-key="cells[2].text"]',
  );
});
