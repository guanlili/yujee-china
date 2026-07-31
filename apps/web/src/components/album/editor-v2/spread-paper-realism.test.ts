import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const desktop = readFileSync(join(here, 'editor-port.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

test('desktop paired spread has a responsive fold band, center seam, and side curvature', () => {
  assert.match(desktop, /\.editor-port \.book::before\{[^}]*width:\s*clamp\(/s);
  assert.match(desktop, /\.editor-port \.book::after\{[^}]*left:\s*50%[^}]*pointer-events:\s*none/s);
  assert.match(desktop, /\.editor-port \.book:not\(\.book-solo\):not\(\.book-full\) \.page-left::before/s);
  assert.match(desktop, /\.editor-port \.book:not\(\.book-solo\):not\(\.book-full\) \.page-right::before/s);
});

test('desktop fold is absent on solo and continuous double-wide states', () => {
  assert.match(desktop, /\.editor-port \.book\.book-solo::before[^}]*display:\s*none/s);
  assert.match(desktop, /\.editor-port \.book\.book-solo::after[^}]*display:\s*none/s);
  assert.match(desktop, /\.editor-port \.book\.book-full::before[^}]*display:\s*none/s);
  assert.match(desktop, /\.editor-port \.book\.book-full::after[^}]*display:\s*none/s);
});

test('desktop turning leaf stays above the spine and carries paper lighting', () => {
  assert.match(desktop, /\.editor-port \.flipper\{[^}]*z-index:\s*6/s);
  assert.match(desktop, /\.editor-port \.leaf::before\{[^}]*pointer-events:\s*none/s);
});
