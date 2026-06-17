import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clampImagePos,
  dragToImagePos,
  zoomImagePos,
  DEFAULT_IMAGE_POS,
  SCALE_MIN,
  SCALE_MAX,
  type ImagePosValue,
} from './image-edit-util';

// ── clampImagePos: the no-white-edge invariant ──
// Under object-fit:cover the box is always filled when x,y∈[0,100] and scale≥1
// (see module header). The clamp's whole job is to keep every candidate inside
// that white-edge-free, contract-legal envelope.

test('clampImagePos keeps in-range values (rounded) untouched', () => {
  assert.deepEqual(clampImagePos({ x: 30, y: 70, scale: 1.5 }), { x: 30, y: 70, scale: 1.5 });
});

test('clampImagePos clamps x,y into [0,100] (no white edge from object-position)', () => {
  assert.deepEqual(clampImagePos({ x: -40, y: 250, scale: 1 }), { x: 0, y: 100, scale: 1 });
});

test('clampImagePos never lets scale drop below 1 (scale<1 would expose white)', () => {
  assert.equal(clampImagePos({ x: 50, y: 50, scale: 0.4 }).scale, SCALE_MIN);
  assert.equal(clampImagePos({ x: 50, y: 50, scale: -3 }).scale, SCALE_MIN);
});

test('clampImagePos caps scale at SCALE_MAX (contract upper bound)', () => {
  assert.equal(clampImagePos({ x: 50, y: 50, scale: 9 }).scale, SCALE_MAX);
});

test('clampImagePos guards NaN inputs to the lower bound', () => {
  assert.deepEqual(clampImagePos({ x: NaN, y: NaN, scale: NaN }), { x: 0, y: 0, scale: SCALE_MIN });
});

test('clampImagePos output is always white-edge-safe over a fuzz sweep', () => {
  for (let i = 0; i < 500; i++) {
    const cand: ImagePosValue = {
      x: (Math.random() - 0.5) * 400,
      y: (Math.random() - 0.5) * 400,
      scale: (Math.random() - 0.5) * 8,
    };
    const out = clampImagePos(cand);
    assert.ok(out.x >= 0 && out.x <= 100, `x ${out.x} out of [0,100]`);
    assert.ok(out.y >= 0 && out.y <= 100, `y ${out.y} out of [0,100]`);
    assert.ok(out.scale >= SCALE_MIN && out.scale <= SCALE_MAX, `scale ${out.scale} out of range`);
  }
});

// ── dragToImagePos: pan direction + sensitivity ──

test('dragToImagePos: dragging right reveals more left → object-position x DECREASES', () => {
  const out = dragToImagePos({ x: 50, y: 50, scale: 1 }, +20, 0, 100, 100);
  assert.equal(out.x, 30); // 50 - (20/100)*100
  assert.equal(out.y, 50);
});

test('dragToImagePos: dragging down decreases y', () => {
  const out = dragToImagePos({ x: 50, y: 50, scale: 1 }, 0, +25, 200, 100);
  assert.equal(out.y, 25); // 50 - (25/100)*100
});

test('dragToImagePos: a full-box drag sweeps the whole 0→100 range', () => {
  // drag left by the full box width from x=0 → +100 of object-position, clamped 100.
  const out = dragToImagePos({ x: 0, y: 50, scale: 1 }, -100, 0, 100, 100);
  assert.equal(out.x, 100);
});

test('dragToImagePos: result is always clamped (no white edge mid-drag)', () => {
  const out = dragToImagePos({ x: 10, y: 10, scale: 1 }, +500, +500, 100, 100);
  assert.deepEqual(out, { x: 0, y: 0, scale: 1 });
});

test('dragToImagePos: zero box size degrades to no movement (no NaN)', () => {
  const out = dragToImagePos({ x: 40, y: 60, scale: 1.2 }, 50, 50, 0, 0);
  assert.deepEqual(out, { x: 40, y: 60, scale: 1.2 });
});

// ── zoomImagePos: scale step + focal point preserved ──

test('zoomImagePos keeps x,y (the focal point) and adds the delta to scale', () => {
  const out = zoomImagePos({ x: 25, y: 75, scale: 1.2 }, 0.3);
  assert.equal(out.x, 25);
  assert.equal(out.y, 75);
  assert.equal(out.scale, 1.5);
});

test('zoomImagePos clamps at both ends', () => {
  assert.equal(zoomImagePos({ ...DEFAULT_IMAGE_POS }, -1).scale, SCALE_MIN);
  assert.equal(zoomImagePos({ x: 50, y: 50, scale: 1.9 }, 1).scale, SCALE_MAX);
});

test('DEFAULT_IMAGE_POS is the white-edge-free center default', () => {
  assert.deepEqual(DEFAULT_IMAGE_POS, { x: 50, y: 50, scale: 1 });
});
