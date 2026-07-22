import assert from 'node:assert/strict';
import test from 'node:test';
import { computeStripScaleTarget } from './candidate-thumbnail';

// #303: pageBox() returns 794x1123 (A4) for every regular template and 1588x1123 for a
// `spread: true` template. No spread template exists in the registry yet, so this pure
// geometry helper is exercised directly with synthetic boxes rather than via the
// template registry or the full renderCandidateThumbnail() flow (which needs a DOM).

test('computeStripScaleTarget: uniform strip of normal pages keys off that page (no-op case)', () => {
  const normal = { width: 794, height: 1123 };
  const target = computeStripScaleTarget([normal, normal, normal]);

  // Same as the pre-#303 behaviour: max(width, height) of the (only) page box.
  assert.equal(target, Math.max(normal.width, normal.height));
});

test('computeStripScaleTarget: mixed strip keys off the narrowest (normal) page, not the widest (spread) page', () => {
  const normal = { width: 794, height: 1123 };
  const spread = { width: 1588, height: 1123 };

  const target = computeStripScaleTarget([normal, spread, normal]);

  // Must equal the normal page's long edge (1123)...
  assert.equal(target, Math.max(normal.width, normal.height));
  // ...and must NOT equal the spread page's long edge (1588), which would shrink every
  // normal page below its intended ~PAGE_MAX_EDGE budget.
  assert.notEqual(target, Math.max(spread.width, spread.height));
});

test('computeStripScaleTarget: order of boxes does not matter', () => {
  const normal = { width: 794, height: 1123 };
  const spread = { width: 1588, height: 1123 };

  const a = computeStripScaleTarget([spread, normal]);
  const b = computeStripScaleTarget([normal, spread]);

  assert.equal(a, b);
  assert.equal(a, Math.max(normal.width, normal.height));
});

test('computeStripScaleTarget: single spread-only strip keys off the spread page itself', () => {
  const spread = { width: 1588, height: 1123 };
  const target = computeStripScaleTarget([spread]);

  assert.equal(target, Math.max(spread.width, spread.height));
});

test('computeStripScaleTarget: empty input falls back to the A4 page box long edge', () => {
  const target = computeStripScaleTarget([]);
  assert.equal(target, 1123);
});
