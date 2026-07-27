import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('./nine-grid-motion.ts', import.meta.url), 'utf8');

test('nine-grid layout frames reuse the website page renderer', () => {
  assert.match(source, /renderFaceToCanvas\(pages\[index\]!/, 'layout frames should use the shared website/PDF renderer');
  assert.match(source, /pages: \(AdaptablePage & \{ html\?: string \}\)\[\]/, 'layout frame input should preserve stored page HTML');
  assert.match(source, /splitSpreadCanvas\(canvas\)/, 'single-page mode should split full-width layouts into physical pages');
});

test('nine-grid spread mode keeps solo, full-width, and paired layouts distinct', () => {
  assert.match(source, /if \(spread\.kind === 'full'\)/, 'full-width layouts should remain one spread');
  assert.match(source, /isSoloSpread\(spread, editorPages\)/, 'cover and ending pages should remain solo');
  assert.match(source, /pairCanvas\(left, right\)/, 'ordinary facing pages should be combined into one layout frame');
});
