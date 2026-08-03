import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// Live 导出视频里的翻页与移动端画布必须是同一本书。这里锁的是「同源」本身:
// 过渡判定/几何/图层/时长全部 import 自 flip.ts,受光与书影走 live-flip-motion
// 的规格常量 —— 任何一处退回「视频专用」的第二套实现,这个测试就红。
// (live-video 是 DOM+WebCodecs 客户端代码,没有 jsdom 夹具,故做源文本断言,
// 与 flipbook-paper-realism.test.ts 同一路数。)

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, 'live-video.ts'), 'utf8');

test('transition decisions and leaf geometry come from mobile flip.ts, not a local copy', () => {
  assert.match(src, /from '@\/components\/album\/editor-v2\/mobile\/flip'/);
  for (const name of ['flipTransition', 'leafGeometry', 'leafLayers', 'edgeMotion', 'edgeLayers']) {
    assert.match(src, new RegExp(`\\b${name}\\(`), `${name} must be called, not re-derived`);
  }
});

test('flip durations and easing are the mobile constants at 30fps', () => {
  assert.match(src, /transitionFrameCount\(FLIP_MS, FPS\)/);
  assert.match(src, /transitionFrameCount\(EDGE_FLIP_MS, FPS\)/);
  assert.match(src, /flipEase\(t\)/);
});

test('the leaf is a true perspective flip with the mobile shading recipe', () => {
  assert.match(src, /px\(PERSPECTIVE\)/, 'perspective must scale with the CSS_DPR viewport mapping');
  assert.match(src, /projectLeafColumn\(/);
  for (const name of ['LEAF_FRONT_EDGE', 'LEAF_BACK_EDGE', 'leafShadeStops', 'LEAF_SHADOW', 'LEAF_INSET_RING']) {
    assert.match(src, new RegExp(`\\b${name}\\b`), `leaf must use ${name}`);
  }
  // 旧的假 3D:cos 挤压宽度 + 平涂 rgba(20,26,38,…) 当受光 —— 不许回来。
  assert.doesNotMatch(src, /HALF_W \* Math\.cos/);
  assert.doesNotMatch(src, /rgba\(20,26,38/);
});

test('book chrome carries the mobile shadows: paper stack, deep spread shadow, spine crease', () => {
  for (const name of ['PAPER_STACK', 'SPREAD_BOOK_SHADOW', 'SPINE_CREASE', 'SPINE_SEAM', 'PAGE_SPINE_LEFT', 'PAGE_SPINE_RIGHT', 'SOLO_BOOK_SHADOW', 'SOLO_INSET_RINGS']) {
    assert.match(src, new RegExp(`\\b${name}\\b`), `book chrome must use ${name}`);
  }
});

test('cover/ending edge flips follow the medge timelines (shadow + under-layer fades)', () => {
  assert.match(src, /EDGE_BOOK_SHADOW/);
  assert.match(src, /edgeUnderAlpha\(/);
  assert.match(src, /startShiftPct/, 'the book must translate with edgeMotion during cover open/close');
});

test('non-flippable transitions (mobile direct-switch) still crossfade instead of hard cutting', () => {
  assert.match(src, /ctx\.globalAlpha = 1 - t/);
});
