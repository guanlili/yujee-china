import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const CSS = readFileSync(new URL('./editor-port.css', import.meta.url), 'utf8');
const PORT = readFileSync(new URL('./EditorPort.tsx', import.meta.url), 'utf8');

// 双宽页占满整个跨页:右 cell 退场(左 cell flex:1 自动撑满)、中缝线隐藏。
test('book-full collapses the empty half and the spine', () => {
  assert.match(CSS, /\.book\.book-full\s*\.page\.page-empty\s*\{[^}]*display:\s*none/);
  assert.match(CSS, /\.book\.book-full::before\s*\{[^}]*display:\s*none/);
});

test('paintSpread toggles book-full from Spread.full', () => {
  assert.match(PORT, /classList\.toggle\(\s*'book-full'\s*,\s*(?:fullIdx\s*!=\s*null|spreads\[i\]\?\.full\s*!=\s*null)\s*\)/);
});

// spreadPages() returns [null, null] for a full-spread index (buildSpreads clears left/right,
// content lives in fullIdx instead) — there is no meaningful way to split a double-wide page
// into a leaf half + facing cell for the flip animation. Without this guard, flipping onto or
// off of a full-spread page would build the leaf from two nulls and paint blank leaves. So
// flipTo must direct-switch (no leaf animation) whenever either endpoint is a full spread.
test('flipTo direct-switches when either endpoint is a full (double-wide) spread', () => {
  const flip = /function flipTo\([^]*?\n    \}/.exec(PORT);
  assert.ok(flip, 'expected to locate the flipTo function body');
  assert.match(
    flip![0],
    /if \(spreads\[currentCh\]\?\.full != null \|\| spreads\[nextIdx\]\?\.full != null\)/,
    'flipTo must skip the leaf animation when either the current or target spread is a full-spread page',
  );
});
