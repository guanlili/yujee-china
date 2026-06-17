import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSpreads, spreadIndexOfPage } from './spreads';
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
