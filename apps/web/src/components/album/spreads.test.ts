import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSpreads, spreadIndexOfPage } from './spreads';
import type { EditorPage } from './types';

// Real template ids carry the slot we group by: mag-01/p01 = cover,
// mag-17 = ending, everything else (mag-03/05/06...) = interior.
function page(templateId: string, pageIndex: number): EditorPage {
  return { pageIndex, templateId, imagesJson: {}, textsJson: {} };
}

test('cover opens recto, ending closes verso, interior pairs in between', () => {
  const pages = [
    page('mag-01', 0), // cover
    page('mag-03', 1), // interior
    page('mag-05', 2), // interior
    page('mag-06', 3), // interior
    page('mag-17', 4), // ending
  ];
  assert.deepEqual(buildSpreads(pages), [
    { left: null, right: 0 }, // cover solo (recto)
    { left: 1, right: 2 }, // interior pair
    { left: 3, right: null }, // odd trailing interior gets a blank half
    { left: 4, right: null }, // ending solo (verso)
  ]);
});

test('cover + ending with no interior are each solo', () => {
  const pages = [page('p01', 0), page('mag-17', 1)];
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
