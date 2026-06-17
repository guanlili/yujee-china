import assert from 'node:assert/strict';
import { test } from 'node:test';

import { clampZoom, paintDecision } from './zoom-util';

// Regression for issue #157 bug A: zooming out past the lower bound must clamp
// to the floor (book stays scaled + visible) and never go below it — going below
// is what used to auto-trigger the "overview" jump that hid the spread.
const ZMIN = 0.25, ZMAX = 2;

test('clampZoom stops at the floor instead of going below', () => {
  // 1 → 0.75 → 0.5 → 0.25 → stays at 0.25 (was: < ZMIN → overview)
  assert.equal(clampZoom(0.5 - 0.25, ZMIN, ZMAX), ZMIN);
  assert.equal(clampZoom(ZMIN - 0.25, ZMIN, ZMAX), ZMIN);
  assert.equal(clampZoom(-5, ZMIN, ZMAX), ZMIN);
});

test('clampZoom stops at the ceiling', () => {
  assert.equal(clampZoom(ZMAX + 0.25, ZMIN, ZMAX), ZMAX);
  assert.equal(clampZoom(99, ZMIN, ZMAX), ZMAX);
});

test('clampZoom passes through in-range values and rounds to 2 decimals', () => {
  assert.equal(clampZoom(1, ZMIN, ZMAX), 1);
  assert.equal(clampZoom(0.75, ZMIN, ZMAX), 0.75);
  // float drift from repeated +0.25 steps is rounded away
  assert.equal(clampZoom(0.1 + 0.2, ZMIN, ZMAX), 0.3);
});

// Regression for issue #157 bug B fix: paintEl deferred 0×0 elements via rAF
// with no termination, so a `display:none` cell (.book / .thumb-strip while
// overview-on) repainted by repaintBook/buildThumbs or the async image .then
// would spin a per-frame rAF loop forever. paintDecision must NEVER return
// 'defer' for a hidden element, and must cap retries for visible-but-0×0 ones.
const CAP = 30;

test('paintDecision skips a hidden (display:none) element — never defers, so no rAF loop', () => {
  // hidden=true is the overview-on .book / .thumb-strip case. Must be 'skip'
  // regardless of measured size or attempt count — this is the loop guard.
  assert.equal(paintDecision(true, 0, 0, 0, CAP), 'skip');
  assert.equal(paintDecision(true, 800, 600, 0, CAP), 'skip');
  assert.equal(paintDecision(true, 0, 0, 99, CAP), 'skip');
});

test('paintDecision defers a visible-but-unmeasured (0×0) element, within the cap', () => {
  assert.equal(paintDecision(false, 0, 0, 0, CAP), 'defer');
  assert.equal(paintDecision(false, 800, 0, 0, CAP), 'defer');
  assert.equal(paintDecision(false, 0, 600, 0, CAP), 'defer');
  assert.equal(paintDecision(false, 0, 0, CAP - 1, CAP), 'defer');
});

test('paintDecision gives up (skip) once a stubborn 0×0-but-visible element hits the cap', () => {
  // defense in depth: even if offsetParent were non-null forever, retries are bounded
  assert.equal(paintDecision(false, 0, 0, CAP, CAP), 'skip');
  assert.equal(paintDecision(false, 0, 0, CAP + 5, CAP), 'skip');
});

test('paintDecision paints a visible element with real dimensions', () => {
  assert.equal(paintDecision(false, 800, 600, 0, CAP), 'paint');
  // a measured element paints even past the cap — cap only gates the defer path
  assert.equal(paintDecision(false, 800, 600, CAP + 1, CAP), 'paint');
});
