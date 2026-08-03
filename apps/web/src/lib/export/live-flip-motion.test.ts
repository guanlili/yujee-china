import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
  EDGE_FLIP_MS,
  FLIP_MS,
} from '../../components/album/editor-v2/mobile/flip';
import {
  EDGE_BOOK_SHADOW,
  EDGE_UNDER_IN,
  EDGE_UNDER_OUT,
  LEAF_BACK_EDGE,
  LEAF_FRONT_EDGE,
  LEAF_SHADOW,
  PAPER_SHEET_LIT,
  PAPER_SHEET_SHADE,
  PAPER_STACK,
  PERSPECTIVE,
  SPREAD_BOOK_SHADOW,
  SPINE_CREASE,
  cubicBezierEase,
  edgeUnderAlpha,
  flipEase,
  leafShadeStops,
  parseCubicBezier,
  projectLeafColumn,
  sampleStops,
  transitionFrameCount,
} from './live-flip-motion';

// Live 导出的翻页动效与移动端画布是同一本书:时长/缓动/受光/书影全部取自
// mobile 那份真相(flip.ts + mobile-editor.css),这里锁住换算层不漂移。

const here = dirname(fileURLToPath(import.meta.url));
const mobileCss = readFileSync(
  join(here, '../../components/album/editor-v2/mobile/mobile-editor.css'),
  'utf8',
);

test('cubic-bezier evaluator matches CSS timing at endpoints and a known midpoint', () => {
  const ease = cubicBezierEase(...parseCubicBezier('cubic-bezier(.45,.05,.2,1)'));
  assert.equal(ease(0), 0);
  assert.equal(ease(1), 1);
  // t=0.5 处 Bézier 解析解:x=0.36875 → y=0.51875(手算,详见曲线定义)。
  assert.ok(Math.abs(ease(0.36875) - 0.51875) < 1e-3);
  // 单调:翻页角度不许回摆。
  let prev = 0;
  for (let i = 1; i <= 100; i++) {
    const y = ease(i / 100);
    assert.ok(y >= prev - 1e-9, `ease not monotonic at ${i / 100}`);
    prev = y;
  }
  // flipEase 就是 FLIP_EASE 那条曲线(同一份常量,不重抄数字)。
  assert.ok(Math.abs(flipEase(0.36875) - 0.51875) < 1e-3);
});

test('frame counts derive from the mobile flip durations', () => {
  assert.equal(transitionFrameCount(FLIP_MS, 30), 27); // 900ms
  assert.equal(transitionFrameCount(EDGE_FLIP_MS, 30), 21); // 700ms
  assert.ok(transitionFrameCount(1, 30) >= 2, 'a transition needs at least 2 frames');
});

test('leaf column projection: flat at 0°, edge-on at 90°, mirrored at 180°', () => {
  const spine = 540;
  const at = (u: number, deg: number) => projectLeafColumn(u, deg, 1, spine, spine, PERSPECTIVE * 3);
  // 0°:平摊在右半边,无透视缩放。
  assert.ok(Math.abs(at(450, 0).x - (spine + 450)) < 1e-6);
  assert.ok(Math.abs(at(450, 0).k - 1) < 1e-6);
  // -90°:纸片立起,所有列都压在书脊线上,离观众最近 → 垂直放大。
  assert.ok(Math.abs(at(450, -90).x - spine) < 1e-6);
  assert.ok(at(450, -90).k > 1);
  // -180°:完整落到左半边,镜像、无缩放。
  assert.ok(Math.abs(at(450, -180).x - (spine - 450)) < 1e-6);
  assert.ok(Math.abs(at(450, -180).k - 1) < 1e-6);
  // 书脊列永远不动。
  assert.ok(Math.abs(at(0, -117).x - spine) < 1e-6);
  // ending 侧(side=-1)对称:0° 时在左半边。
  const left = projectLeafColumn(450, 180, -1, spine, spine, PERSPECTIVE * 3);
  assert.ok(Math.abs(left.x - (spine + 450)) < 1e-6);
});

test('gradient sampling is premultiplied like CSS (no gray fringe at transparent stops)', () => {
  const at0 = sampleStops(LEAF_FRONT_EDGE, 0);
  assert.ok(Math.abs(at0[3] - 0.12) < 1e-9, 'spine edge of the front face starts at .12 black');
  assert.ok(sampleStops(LEAF_FRONT_EDGE, 0.26)[3] < 1e-9, 'transparent stop hits zero alpha');
  const mid = sampleStops(LEAF_FRONT_EDGE, 0.63);
  assert.equal(mid[0], 255, 'past the transparent stop the tint is pure white, not gray');
  const back = sampleStops(LEAF_BACK_EDGE, 1);
  assert.ok(Math.abs(back[3] - 0.15) < 1e-9);
});

test('leaf shade keeps the FlipBook page-turn recipe per direction', () => {
  // next:外口侧压暗 .08(与 flip.ts leafShading 的 'transparent 70%, rgba(0,0,0,.08)' 同源)。
  assert.ok(sampleStops(leafShadeStops('next'), 0)[3] < 1e-9);
  assert.ok(Math.abs(sampleStops(leafShadeStops('next'), 1)[3] - 0.08) < 1e-9);
  assert.ok(Math.abs(sampleStops(leafShadeStops('prev'), 0)[3] - 0.08) < 1e-9);
  assert.ok(sampleStops(leafShadeStops('prev'), 0.3)[3] < 1e-9);
});

test('edge under-layer fade follows the medge keyframe timeline', () => {
  // 开卷:正文与书脊 210ms 后 200ms 内显现(medge-under-in 200ms 210ms)。
  assert.equal(edgeUnderAlpha(true, 0), 0);
  assert.equal(edgeUnderAlpha(true, EDGE_UNDER_IN.delay), 0);
  assert.equal(edgeUnderAlpha(true, EDGE_UNDER_IN.delay + EDGE_UNDER_IN.duration), 1);
  assert.equal(edgeUnderAlpha(true, EDGE_FLIP_MS), 1);
  // 合卷镜像:350ms 起 180ms 内隐去。
  assert.equal(edgeUnderAlpha(false, 0), 1);
  assert.equal(edgeUnderAlpha(false, EDGE_UNDER_OUT.delay), 1);
  assert.equal(edgeUnderAlpha(false, EDGE_UNDER_OUT.delay + EDGE_UNDER_OUT.duration), 0);
  assert.equal(edgeUnderAlpha(false, EDGE_FLIP_MS), 0);
});

test('shadow and paper specs mirror mobile-editor.css literally', () => {
  // 翻动纸片投影。
  assert.match(mobileCss, /box-shadow:0 12px 14px rgba\(20,24,23,\.22\)/);
  assert.deepEqual(LEAF_SHADOW, { y: 12, blur: 14, color: 'rgba(20,24,23,.22)' });
  // 摊开书体的三层加深投影。
  assert.match(
    mobileCss,
    /0 2px 4px rgba\(20,24,23,\.20\),\s*0 14px 30px rgba\(20,24,23,\.18\),\s*0 34px 70px rgba\(20,24,23,\.16\)/,
  );
  assert.deepEqual(
    SPREAD_BOOK_SHADOW.map((s) => [s.y, s.blur]),
    [
      [2, 4],
      [14, 30],
      [34, 70],
    ],
  );
  // 封皮开合/独页投影(medge-shadow-in 终值 = resting-solo .mpage 的前两层)。
  assert.match(
    mobileCss,
    /0 2px 5px rgba\(24, 28, 27, 0\.18\),\s*0 18px 42px rgba\(24, 28, 27, 0\.16\)/,
  );
  assert.deepEqual(
    EDGE_BOOK_SHADOW.map((s) => [s.y, s.blur]),
    [
      [2, 5],
      [18, 42],
    ],
  );
  // 书口纸叠:±2/3.5/5/6.5/8,负 spread 逐层内缩,lit/shade 交替。
  assert.match(mobileCss, /-8px 0 0 -3px var\(--paper-sheet-lit\)/);
  assert.deepEqual(
    PAPER_STACK.map((s) => [s.x, s.shrink]),
    [
      [2, 1],
      [3.5, 1.5],
      [5, 2],
      [6.5, 2.5],
      [8, 3],
    ],
  );
  assert.equal(PAPER_SHEET_LIT, '#fcfbf8');
  assert.equal(PAPER_SHEET_SHADE, '#d9d4ca');
  // 书脊沟槽:50% 处最深 .24(与 mspread::before 同一条渐变)。
  assert.match(mobileCss, /rgba\(0,0,0,\.24\) 50%/);
  const deepest = SPINE_CREASE.find((s) => s.at === 0.5);
  assert.ok(deepest && Math.abs(deepest.color[3] - 0.24) < 1e-9);
  // 3D 景深与 .mboard 的 perspective 同款。
  assert.match(mobileCss, /perspective: 2400px/);
  assert.equal(PERSPECTIVE, 2400);
});
