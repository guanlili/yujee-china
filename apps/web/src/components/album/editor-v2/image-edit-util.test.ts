import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clampImagePos,
  coverContentBox,
  coverCropFraction,
  dragToImagePos,
  normalizeRotate,
  previewDragToImagePos,
  rotateDragDelta,
  rotateImagePos,
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

// ── coverCropFraction / previewDragToImagePos:弹窗预览几何(2026-08-02 设计)──
// 推导见 image-edit-util.ts 抬头 + docs/specs/2026-08-02-image-edit-popup-preview-design.md:
// k0 = max(frameW/natW, frameH/natH),k = k0*scale;fx = frameW/(natW*k);
// left = x/100*(1-fx)。

test('coverCropFraction: 宽图塞方框,scale=1 → 高度满幅,水平有余量', () => {
  // 原图 200×100,框 100×100:k0 = max(0.5, 1) = 1 → fx = 100/200 = 0.5, fy = 1。
  const crop = coverCropFraction(200, 100, 100, 100, { x: 50, y: 50, scale: 1 });
  assert.ok(crop);
  assert.equal(crop!.width, 0.5);
  assert.equal(crop!.height, 1);
  assert.equal(crop!.left, 0.25); // 居中:50% 的 (1-0.5)
  assert.equal(crop!.top, 0); // 满幅轴没有余量
  // x=0 → 贴左;x=100 → 贴右
  assert.equal(coverCropFraction(200, 100, 100, 100, { x: 0, y: 50, scale: 1 })!.left, 0);
  assert.equal(coverCropFraction(200, 100, 100, 100, { x: 100, y: 50, scale: 1 })!.left, 0.5);
});

test('coverCropFraction: scale=2 → 可见窗口两轴同时减半', () => {
  const crop = coverCropFraction(200, 100, 100, 100, { x: 50, y: 50, scale: 2 });
  assert.ok(crop);
  assert.equal(crop!.width, 0.25);
  assert.equal(crop!.height, 0.5);
  assert.equal(crop!.left, 0.375); // (1-0.25)/2
  assert.equal(crop!.top, 0.25); // (1-0.5)/2
});

test('coverCropFraction: 尺寸非法(0/负/NaN)→ null,绝不产出 NaN 几何', () => {
  assert.equal(coverCropFraction(0, 100, 100, 100, DEFAULT_IMAGE_POS), null);
  assert.equal(coverCropFraction(200, 100, 0, 100, DEFAULT_IMAGE_POS), null);
  assert.equal(coverCropFraction(200, -1, 100, 100, DEFAULT_IMAGE_POS), null);
  assert.equal(coverCropFraction(NaN, 100, 100, 100, DEFAULT_IMAGE_POS), null);
});

test('previewDragToImagePos: 把图往右拖 = 露出左侧 = x 减小(与画布 dragToImagePos 同向)', () => {
  // 预览整图 200px 宽,fx=0.5 → 水平可滑余量 = 200*(1-0.5) = 100px。
  const crop = coverCropFraction(200, 100, 100, 100, { x: 50, y: 50, scale: 1 })!;
  const out = previewDragToImagePos({ x: 50, y: 50, scale: 1 }, 25, 0, 200, 100, crop);
  assert.equal(out.x, 25); // 25px / 100px 余量 = 25 个百分点
  assert.equal(out.y, 50);
});

test('previewDragToImagePos: 满幅轴(无余量)忽略拖动,不产出 NaN', () => {
  const crop = coverCropFraction(200, 100, 100, 100, { x: 50, y: 50, scale: 1 })!;
  const out = previewDragToImagePos({ x: 50, y: 50, scale: 1 }, 0, 30, 200, 100, crop);
  assert.equal(out.y, 50, 'fy=1 的轴不动');
});

test('previewDragToImagePos: 越界拖动被 clamp 在 0..100', () => {
  const crop = coverCropFraction(200, 100, 100, 100, { x: 50, y: 50, scale: 1 })!;
  assert.equal(previewDragToImagePos({ x: 50, y: 50, scale: 1 }, 999, 0, 200, 100, crop).x, 0);
  assert.equal(previewDragToImagePos({ x: 50, y: 50, scale: 1 }, -999, 0, 200, 100, crop).x, 100);
});

// ── rotate:归一化 / 转一步 / 拖动补偿(2026-08-02 图片旋转)──────────────────

test('normalizeRotate: 吸附 90 倍数,0/360 归一为 undefined(不落库)', () => {
  assert.equal(normalizeRotate(undefined), undefined);
  assert.equal(normalizeRotate(0), undefined);
  assert.equal(normalizeRotate(360), undefined);
  assert.equal(normalizeRotate(90), 90);
  assert.equal(normalizeRotate(450), 90);
  assert.equal(normalizeRotate(-90), 270);
  assert.equal(normalizeRotate(NaN), undefined);
});

test('rotateImagePos: 顺时针循环 0→90→180→270→0,x/y/scale 原样保留', () => {
  let pos: ImagePosValue = { x: 30, y: 70, scale: 1.4 };
  pos = rotateImagePos(pos);
  assert.deepEqual(pos, { x: 30, y: 70, scale: 1.4, rotate: 90 });
  pos = rotateImagePos(rotateImagePos(rotateImagePos(pos)));
  assert.deepEqual(pos, { x: 30, y: 70, scale: 1.4 }, '转满一圈回到无 rotate');
});

test('clampImagePos: rotate 随位置一起归一;非法角度吸附', () => {
  assert.deepEqual(clampImagePos({ x: 50, y: 50, scale: 1, rotate: 180 }).rotate, 180);
  assert.equal(clampImagePos({ x: 50, y: 50, scale: 1, rotate: 0 }).rotate, undefined);
  assert.equal(clampImagePos({ x: 50, y: 50, scale: 1 }).rotate, undefined);
});

test('rotateDragDelta: image = R(-θ)·screen,未旋转时逐像素恒等', () => {
  assert.deepEqual(rotateDragDelta(undefined, 10, 4), { dx: 10, dy: 4 });
  assert.deepEqual(rotateDragDelta(90, 10, 4), { dx: 4, dy: -10 });
  assert.deepEqual(rotateDragDelta(180, 10, 4), { dx: -10, dy: -4 });
  assert.deepEqual(rotateDragDelta(270, 10, 4), { dx: -4, dy: 10 });
});

// ── coverContentBox:导出摊平几何(2026-08-02,html2canvas 忽略 object-position 的绕行)──

test('coverContentBox: 与 coverCropFraction 互逆 —— content 偏移 = -crop.left × content 宽', () => {
  const pos: ImagePosValue = { x: 30, y: 80, scale: 1.5 };
  const box = coverContentBox(200, 100, 100, 100, pos)!;
  const crop = coverCropFraction(200, 100, 100, 100, pos)!;
  // crop 是「图框露出内容的哪一段」,content box 是「内容摆在图框的哪里」,同一几何
  assert.ok(Math.abs(box.left + crop.left * box.width) < 1e-9);
  assert.ok(Math.abs(box.top + crop.top * box.height) < 1e-9);
  // 图框恰好被盖满:内容尺寸 × 可见比例 = 图框尺寸
  assert.ok(Math.abs(box.width * crop.width - 100) < 1e-9);
  assert.ok(Math.abs(box.height * crop.height - 100) < 1e-9);
});

test('coverContentBox: 居中缺省位 = 溢出轴均分,满幅轴零偏移', () => {
  // 200×100 图 cover 进 100×100 框:k=1,内容 200×100,水平溢出 100 → 居中各让 50
  const box = coverContentBox(200, 100, 100, 100, { x: 50, y: 50, scale: 1 })!;
  assert.equal(box.width, 200);
  assert.equal(box.height, 100);
  assert.equal(box.left, -50);
  assert.equal(Math.abs(box.top), 0);
});

test('coverContentBox: 尺寸非法 → null', () => {
  assert.equal(coverContentBox(0, 100, 100, 100, DEFAULT_IMAGE_POS), null);
  assert.equal(coverContentBox(200, 100, 100, 0, DEFAULT_IMAGE_POS), null);
});
