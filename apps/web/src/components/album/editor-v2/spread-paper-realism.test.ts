import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const desktop = readFileSync(join(here, 'editor-port.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const mobile = readFileSync(join(here, 'mobile/mobile-editor.css'), 'utf8')
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

test('mobile paired spread has a responsive fold, seam, and side curvature', () => {
  assert.match(mobile, /\.mobile-editor \.mspread\[data-paper-spine='1'\]::before\{[^}]*width:\s*clamp\(/s);
  assert.match(mobile, /\.mobile-editor \.mspread\[data-paper-spine='1'\]::after\{[^}]*left:\s*50%[^}]*pointer-events:\s*none/s);
  assert.match(mobile, /\.mobile-editor \.mspread\[data-paper-spine='1'\] \.mpage:first-of-type::before/s);
  assert.match(mobile, /\.mobile-editor \.mspread\[data-paper-spine='1'\] \.mpage:nth-of-type\(2\)::before/s);
});

test('mobile exposes a spine only when both rendered halves contain real pages', () => {
  const component = readFileSync(join(here, 'mobile/MobileEditor.tsx'), 'utf8');
  assert.match(
    component,
    /data-paper-spine=\{faces\.length === 2 && faces\.every\(\(pageIndex\) => pageIndex != null\) \? '1' : undefined\}/,
  );
});

test('mobile moving leaf stays above the fold and carries two-sided lighting', () => {
  assert.match(mobile, /\.mobile-editor \.mleaf\{[^}]*z-index:\s*6/s);
  assert.match(mobile, /\.mobile-editor \.mleaf-face::after\{[^}]*pointer-events:\s*none/s);
  assert.match(mobile, /\.mobile-editor \.mleaf-back::after/s);
});
