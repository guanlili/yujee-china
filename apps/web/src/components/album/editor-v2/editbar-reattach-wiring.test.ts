import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// Structural guards for the element-toolbar re-anchor. The decision logic itself
// is unit-tested in edit-anchor-util.test.ts; what CANNOT be unit-tested without a
// jsdom harness (this repo has none — tests run under `tsx --test`) is that the
// repaint paths actually CALL it. That call site is the whole bug: `paintEl`
// replaces a page's nodes, `reattachImgEdit()` rescued the image overlay, and the
// toolbar anchor was left pointing at a detached node — silently, because
// `matches()` still passes on detached nodes, so colour/font clicks wrote styles
// into a node nobody can see.

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, 'EditorPort.tsx'), 'utf8');

function bodyOf(name: string): string {
  const re = new RegExp(`function ${name}\\([\\s\\S]*?\\n {4}\\}`);
  const m = re.exec(src);
  assert.ok(m, `${name} must exist in EditorPort.tsx`);
  return m![0];
}

test('reattachEditBar exists and is built on the pure edit-anchor helpers', () => {
  const body = bodyOf('reattachEditBar');
  assert.match(body, /resolveEditAnchor\(/);
  assert.match(body, /editAnchorSelector\(/);
});

test('EditorPort imports the pure anchor helpers rather than re-deriving them', () => {
  assert.match(src, /from '\.\/edit-anchor-util'/);
});

test('repaintPages re-anchors the toolbar, not just the image overlay', () => {
  // The dirty-page repaint path (perf work: 编辑器 20+ 页卡顿治理) is the one an AI
  // page write goes through, so it is the path that made the bug show up "一阵一阵".
  const body = bodyOf('repaintPages');
  assert.match(body, /reattachImgEdit\(\)/, 'image overlay rescue must stay');
  assert.match(body, /reattachEditBar\(\)/, 'toolbar anchor must be rescued too');
});

test('repaintBook re-anchors the toolbar, not just the image overlay', () => {
  const body = bodyOf('repaintBook');
  assert.match(body, /reattachImgEdit\(\)/, 'image overlay rescue must stay');
  assert.match(body, /reattachEditBar\(\)/, 'toolbar anchor must be rescued too');
});

test('showElementToolbar records the anchor identity that survives a repaint', () => {
  // A detached text node cannot report its own page index (innerHTML replacement
  // orphans it below the [data-page-index] host), so the identity MUST be captured
  // while the anchor is still live.
  const body = bodyOf('showElementToolbar');
  assert.match(body, /editBarAnchorId\s*=\s*editAnchorId\(/);
});

test('hideElementToolbar drops the recorded identity with the anchor', () => {
  const body = bodyOf('hideElementToolbar');
  assert.match(body, /editBarAnchorId\s*=\s*null/);
});
