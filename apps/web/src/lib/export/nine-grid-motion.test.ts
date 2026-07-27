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

test('nine-grid video paginates every nine layouts without dropping overflow', () => {
  assert.match(source, /const LAYOUTS_PER_SCENE = 9;/, 'each motion scene should contain at most nine layouts');
  assert.match(source, /Math\.ceil\(images\.length \/ LAYOUTS_PER_SCENE\)/, 'overflow layouts should create another scene');
  assert.match(source, /sceneCount \* options\.duration/, 'every scene should keep the configured 4.4-second duration');
  assert.match(source, /const images = await Promise\.all\(imageSources\.map\(loadImage\)\);/, 'video input should load every layout without an old global limit');
  assert.doesNotMatch(source, /buildSpreads\(editorPages\)\.slice/, 'spread mode should render every book spread');
});

test('Live bundle cover is a stable, orderly 3 by 3 layout', () => {
  assert.match(source, /renderNineGridCover\(/, 'a still cover renderer should be exported');
  assert.match(source, /imageSources\.slice\(0, LAYOUTS_PER_SCENE\)/, 'cover should use the first scene of up to nine layouts');
  assert.match(source, /const columns = 3;/, 'cover should use three columns');
  assert.match(source, /drawCard\([\s\S]*?1,\s*1,\s*0,/, 'cover cards should be fully visible, unscaled, and unrotated');
});

test('mixed single-page and spread cards preserve their own aspect ratios', () => {
  assert.match(source, /function fitCardSize\(/, 'card sizing should be derived per layout');
  assert.match(source, /const ratio = clampRatio\(image\.width \/ image\.height\)/, 'each card should use its own source ratio');
  assert.match(source, /const card = fitCardSize\(image, cellWidth, cellHeight\)/, 'both portrait and landscape cards should fit within neutral grid cells');
  assert.doesNotMatch(source, /const firstRatio =/, 'the first portrait cover must not force every spread into portrait cards');
});

test('video starts with a complete still cover before motion begins', () => {
  assert.match(source, /const COVER_HOLD_SECONDS = 0\.8;/, 'video cover should remain visible long enough for thumbnail extraction');
  assert.match(source, /if \(seconds < COVER_HOLD_SECONDS\) \{\s*renderCoverFrame\(/, 'the first recorded frames should paint the complete cover');
  assert.match(source, /COVER_HOLD_SECONDS \+ sceneCount \* options\.duration/, 'cover hold should not shorten any motion scene');
});
