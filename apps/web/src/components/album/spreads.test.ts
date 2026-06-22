import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSpreads, isSoloSpread, spreadIndexOfPage } from './spreads';
import type { EditorPage } from './types';

// Real template ids carry the slot we group by: mag-01/p01 = cover, current
// non-cover templates (mag-03/05/06...) = interior.
function page(templateId: string, pageIndex: number): EditorPage {
  return { pageIndex, templateId, imagesJson: {}, textsJson: {} };
}

test('cover opens recto, interior pages pair in between', () => {
  const pages = [
    page('mag-01', 0), // cover
    page('mag-03', 1), // interior
    page('mag-05', 2), // interior
    page('mag-06', 3), // interior
    page('mag-19', 4), // interior
  ];
  assert.deepEqual(buildSpreads(pages), [
    { left: null, right: 0 }, // cover solo (recto)
    { left: 1, right: 2 }, // interior pair
    { left: 3, right: 4 }, // interior pair
  ]);
});

test('cover + one interior leaves the interior with a blank facing half', () => {
  const pages = [page('p01', 0), page('mag-03', 1)];
  assert.deepEqual(buildSpreads(pages), [
    { left: null, right: 0 },
    { left: 1, right: null },
  ]);
});

test('interior-only pairs two-up, odd gets a blank half', () => {
  assert.deepEqual(
    buildSpreads([page('mag-03', 0), page('mag-05', 1)]),
    [{ left: 0, right: 1 }],
  );
  assert.deepEqual(
    buildSpreads([page('mag-03', 0), page('mag-05', 1), page('mag-06', 2)]),
    [{ left: 0, right: 1 }, { left: 2, right: null }],
  );
});

test('spreadIndexOfPage finds the spread holding a page index', () => {
  const spreads = buildSpreads([
    page('mag-01', 0),
    page('mag-03', 1),
    page('mag-05', 2),
  ]);
  assert.equal(spreadIndexOfPage(spreads, 0), 0); // cover
  assert.equal(spreadIndexOfPage(spreads, 1), 1); // interior pair
  assert.equal(spreadIndexOfPage(spreads, 2), 1);
  assert.equal(spreadIndexOfPage(spreads, 99), -1);
});

// ── issue #158 parity regression: cover/ending are solo half-pages, so any
// extra cover (mag-13/p01) or a mid-document ending shifts the parity of every
// following interior pair. The old flat ceil/floor pagination got this wrong.

test('ending closes verso; full cover→interior→ending lays out solo + paired', () => {
  const pages = [
    page('mag-01', 0), // cover (solo recto)
    page('mag-03', 1), // interior
    page('mag-05', 2), // interior
    page('mag-06', 3), // interior
    page('mag-20', 4), // ending (solo verso)
  ];
  assert.deepEqual(buildSpreads(pages), [
    { left: null, right: 0 }, // cover solo
    { left: 1, right: 2 }, // interior pair
    { left: 3, right: null }, // odd interior flushed before ending → blank half
    { left: 4, right: null }, // ending solo (verso)
  ]);
});

test('a second cover mid-document re-aligns following interior parity', () => {
  const pages = [
    page('mag-01', 0), // cover
    page('mag-03', 1), // interior
    page('mag-13', 2), // second cover (mid-document) — forces a solo spread
    page('mag-05', 3), // interior
    page('mag-06', 4), // interior
  ];
  assert.deepEqual(buildSpreads(pages), [
    { left: null, right: 0 }, // cover solo
    { left: 1, right: null }, // lone interior flushed before the second cover
    { left: null, right: 2 }, // second cover solo recto
    { left: 3, right: 4 }, // interior pair, parity re-based after the cover
  ]);
  // spreadIndexOfPage must follow the shifted parity, not a flat /2.
  assert.equal(spreadIndexOfPage(buildSpreads(pages), 3), 3);
  assert.equal(spreadIndexOfPage(buildSpreads(pages), 4), 3);
});

test('an ending mid-document forces the next interior onto a fresh pair', () => {
  const pages = [
    page('mag-01', 0), // cover
    page('mag-03', 1), // interior
    page('mag-20', 2), // ending mid-document — solo verso
    page('mag-05', 3), // interior after the ending
    page('mag-06', 4), // interior
  ];
  assert.deepEqual(buildSpreads(pages), [
    { left: null, right: 0 }, // cover solo
    { left: 1, right: null }, // lone interior flushed before the ending
    { left: 2, right: null }, // ending solo verso
    { left: 3, right: 4 }, // fresh interior pair after the ending
  ]);
});

// ── WP4.2 / §4.4 skip cases: V3 makes the book-design step optional, so the
// "page 0 must be cover" rule is gone (§4.1). The canvas must lay the book out
// without injecting a blank solo spread or crashing when the cover, the ending,
// or both are skipped. Interior-only pages just pair two-up from the first page.

test('skip cover: an album with no cover starts straight into a paired interior spread', () => {
  const pages = [
    page('mag-03', 0), // interior (no cover ahead of it — book opens here)
    page('mag-05', 1), // interior
    page('mag-06', 2), // interior
    page('mag-20', 3), // ending (solo verso)
  ];
  // No leading { left: null, right: 0 } cover spread is fabricated — the first
  // interior pair is the first spread. The ending still closes solo.
  assert.deepEqual(buildSpreads(pages), [
    { left: 0, right: 1 }, // interior pair (book opens here, no blank cover page)
    { left: 2, right: null }, // odd interior flushed before the ending
    { left: 3, right: null }, // ending solo verso
  ]);
});

test('skip ending: an album with a cover but no ending closes on a paired interior spread', () => {
  const pages = [
    page('mag-01', 0), // cover (solo recto)
    page('mag-03', 1), // interior
    page('mag-05', 2), // interior
  ];
  // No trailing { left: i, right: null } ending spread is fabricated — the book
  // just ends on the last interior pair (which here is complete, no blank half).
  assert.deepEqual(buildSpreads(pages), [
    { left: null, right: 0 }, // cover solo recto
    { left: 1, right: 2 }, // interior pair closes the book
  ]);
});

test('skip both: an interior-only album never gets a fabricated blank solo spread', () => {
  const pages = [
    page('mag-03', 0),
    page('mag-05', 1),
    page('mag-06', 2),
    page('mag-19', 3),
  ];
  assert.deepEqual(buildSpreads(pages), [
    { left: 0, right: 1 },
    { left: 2, right: 3 },
  ]);
});

test('empty book: zero pages yields zero spreads (no crash, no blank page)', () => {
  // The draft/cover step can legitimately leave the book empty (skip everything).
  // buildSpreads must return []; EditorBook.spreadCount() clamps this to a single
  // visible (empty) spread, so the canvas never indexes into a missing spread.
  assert.deepEqual(buildSpreads([]), []);
});

// ── solo-page classification (FlipBook single-page render). A cover/ending sits
// on its own spread and must render as ONE centered page (no blank facing half,
// no spine). The trap: an interior odd-trailing page has the IDENTICAL shape
// ({ left: i, right: null }) but its blank half is normal spread whitespace and
// must stay — so isSoloSpread keys off the occupied page's category, never off
// "a half is null".

test('isSoloSpread: cover-solo (left null, right=cover) is solo', () => {
  const pages = [page('mag-01', 0), page('mag-03', 1), page('mag-05', 2)];
  const spreads = buildSpreads(pages);
  // [{ left: null, right: 0 }, { left: 1, right: 2 }]
  assert.equal(isSoloSpread(spreads[0], pages), true);
});

test('isSoloSpread: ending-solo (left=ending, right null) is solo', () => {
  const pages = [
    page('mag-01', 0), // cover
    page('mag-03', 1), // interior
    page('mag-05', 2), // interior
    page('mag-20', 3), // ending (solo verso)
  ];
  const spreads = buildSpreads(pages);
  const endingSpread = spreads.find((s) => s.left === 3);
  assert.ok(endingSpread, 'expected an ending spread holding page 3');
  assert.equal(isSoloSpread(endingSpread, pages), true);
});

test('isSoloSpread: interior odd-trailing { left:i, right:null } is NOT solo (keeps blank half)', () => {
  // Three interior pages → one full pair + one odd trailing interior with a blank
  // facing half. That blank half is normal whitespace, NOT a solo page.
  const pages = [page('mag-03', 0), page('mag-05', 1), page('mag-06', 2)];
  const spreads = buildSpreads(pages);
  // [{ left: 0, right: 1 }, { left: 2, right: null }]
  assert.deepEqual(spreads[1], { left: 2, right: null });
  assert.equal(
    isSoloSpread(spreads[1], pages),
    false,
    'interior odd-trailing must stay a double-width spread with a blank half',
  );
});

test('isSoloSpread: a paired interior spread is never solo', () => {
  const pages = [page('mag-03', 0), page('mag-05', 1)];
  const spreads = buildSpreads(pages); // [{ left: 0, right: 1 }]
  assert.equal(isSoloSpread(spreads[0], pages), false);
});

test('isSoloSpread: undefined / out-of-range spread is not solo (no crash)', () => {
  const pages = [page('mag-01', 0)];
  assert.equal(isSoloSpread(undefined, pages), false);
  assert.equal(isSoloSpread({ left: 99, right: null }, pages), false);
});
