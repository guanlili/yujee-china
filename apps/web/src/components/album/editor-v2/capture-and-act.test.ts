import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// #165 Phase 3 source-assertion guards for the parts of EditorPort.tsx that are a
// single imperative DOM effect (no jsdom harness in this repo — tests run under
// `tsx --test`; the orchestration control flow itself is covered separately in
// draft-edit-orchestrator.test.ts). Here we lock the load-bearing invariants of
// capturePageRender (privacy + small JPEG payload) and the imagePosWrite apply.

const here = dirname(fileURLToPath(import.meta.url));
// The capture/act wiring moved out of EditorPort.tsx into ChatPanel.tsx (dialogue)
// and editor-coordinator.ts (the canvas↔chat bridge). These structural guards don't
// care which of the three a symbol lives in, so `src` is the three merged.
const src = ['EditorPort.tsx', 'ChatPanel.tsx', 'editor-coordinator.ts']
  .map((f) => readFileSync(join(here, f), 'utf8'))
  .join('\n\n');

test('capturePageRender encodes a downscaled JPEG (small payload)', () => {
  assert.match(src, /async function capturePageRender\(/);
  // ~840px downscale + JPEG q0.8 keeps the data URI small.
  assert.match(src, /Math\.min\(840,/);
  assert.match(src, /toDataURL\(\s*['"]image\/jpeg['"],\s*0\.8\s*\)/);
});

test('capturePageRender carries the privacy posture in a comment (invariant 1/2)', () => {
  // The screenshot contains user photos and goes to the vision model; the source
  // MUST document that it is not logged/stored (same posture as init vision).
  const fn = /async function capturePageRender[\s\S]*?\n {4}\}/.exec(src);
  assert.ok(fn, 'capturePageRender must exist');
  const region = src.slice(Math.max(0, src.indexOf('PRIVACY (invariant 1/2)') - 200), src.indexOf('async function capturePageRender'));
  assert.match(region, /PRIVACY \(invariant 1\/2\)/);
  assert.match(region, /NOT logged.*NOT stored|not logged.*not stored/i);
});

test('imagePosWrite folds {x,y,scale} into the page imagePosJson[imageId] + repaints', () => {
  const fn = /function applyDraftAct\([\s\S]*?\n {4}\}/.exec(src);
  assert.ok(fn, 'applyDraftAct must exist');
  const body = fn![0];
  // pageWrite path merges texts; imagePosWrite path merges the single slot pos.
  assert.match(body, /imagePosJson\s*=\s*\{[\s\S]*\[w\.imageId\]:\s*\{ x: w\.x, y: w\.y, scale: w\.scale \}/);
  assert.match(body, /repaintBook\(\)/);
});

test('the draft-edit turn delegates to the pure inspect→adjust loop', () => {
  assert.match(src, /import \{ runInspectAdjustLoop \} from '\.\/draft-edit-orchestrator'/);
  assert.match(src, /await runInspectAdjustLoop\(/);
});
