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
