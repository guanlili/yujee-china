import assert from 'node:assert/strict';
import { test } from 'node:test';

import { alphaFromMaskPixels, buildAlphaMask, featherMask } from './cutout-math';

/** 造一张 w×h 的 RGBA 图:fill 是底色,rect 区域涂成另一色。 */
function makeImage(w: number, h: number, bg: [number, number, number], rect?: {
  x0: number; y0: number; x1: number; y1: number; color: [number, number, number];
}) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const inRect = rect && x >= rect.x0 && x <= rect.x1 && y >= rect.y0 && y <= rect.y1;
      const [r, g, b] = inRect ? rect!.color : bg;
      const i = (y * w + x) * 4;
      px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
    }
  }
  return px;
}
const at = (mask: Uint8ClampedArray, w: number, x: number, y: number) => mask[y * w + x]!;

test('纯色背景里的主体被留下,背景被抹成透明', () => {
  const w = 9, h = 9;
  const px = makeImage(w, h, [255, 255, 255], { x0: 3, y0: 3, x1: 5, y1: 5, color: [10, 10, 10] });
  const mask = buildAlphaMask(px, w, h, { tolerance: 10 });
  assert.equal(at(mask, w, 4, 4), 255, '主体中心应保留');
  assert.equal(at(mask, w, 0, 0), 0, '角落应判为背景');
  assert.equal(at(mask, w, 8, 4), 0, '右边缘应判为背景');
});

test('主体贴到画面边缘时不被吃掉 —— 只要它和边缘底色差得够远', () => {
  const w = 9, h = 9;
  // 主体从左边缘一直延伸到中间
  const px = makeImage(w, h, [255, 255, 255], { x0: 0, y0: 3, x1: 4, y1: 5, color: [10, 10, 10] });
  const mask = buildAlphaMask(px, w, h, { tolerance: 10 });
  assert.equal(at(mask, w, 0, 4), 255, '贴边的主体像素不该被当成背景');
  assert.equal(at(mask, w, 0, 0), 0);
});

test('容差为 0 时只抹掉与边缘完全同色的像素', () => {
  const w = 7, h = 7;
  const px = makeImage(w, h, [250, 250, 250], { x0: 2, y0: 2, x1: 4, y1: 4, color: [248, 248, 248] });
  const strict = buildAlphaMask(px, w, h, { tolerance: 0 });
  assert.equal(at(strict, w, 3, 3), 255, '差 2 也算主体');
  const loose = buildAlphaMask(px, w, h, { tolerance: 12 });
  assert.equal(at(loose, w, 3, 3), 0, '放宽容差后连成一片');
});

test('主体与背景同色时会被一起抹掉 —— 这是像素法的固有局限,不是 bug', () => {
  // 把这个行为钉死:将来换成分割模型时,这条测试应该跟着换掉,而不是被绕过。
  const w = 7, h = 7;
  const px = makeImage(w, h, [255, 255, 255], { x0: 2, y0: 2, x1: 4, y1: 4, color: [255, 255, 255] });
  const mask = buildAlphaMask(px, w, h, { tolerance: 4 });
  assert.equal(at(mask, w, 3, 3), 0);
});

test('四角颜色不一样时,每个角各按自己的底色扩散', () => {
  const w = 8, h = 2;
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i += 1) {
    const left = (i % w) < w / 2;
    px[i * 4] = left ? 0 : 255;
    px[i * 4 + 1] = left ? 0 : 255;
    px[i * 4 + 2] = left ? 0 : 255;
    px[i * 4 + 3] = 255;
  }
  const mask = buildAlphaMask(px, w, h, { tolerance: 8 });
  assert.equal(at(mask, w, 0, 0), 0, '左半按黑色底扩散');
  assert.equal(at(mask, w, 7, 0), 0, '右半按白色底扩散');
});

test('羽化让边界出现中间值 —— 否则边缘是硬锯齿,一眼看出是机器抠的', () => {
  const w = 9, h = 9;
  const px = makeImage(w, h, [255, 255, 255], { x0: 3, y0: 3, x1: 5, y1: 5, color: [10, 10, 10] });
  const hard = buildAlphaMask(px, w, h, { tolerance: 10 });
  const soft = featherMask(hard, w, h, 1);
  assert.equal(at(soft, w, 4, 4), 255, '主体内部仍不透明');
  assert.equal(at(soft, w, 0, 0), 0, '远处背景仍全透');
  const edge = at(soft, w, 3, 3);
  assert.ok(edge > 0 && edge < 255, `边界应是中间值,实际 ${edge}`);
});

test('羽化半径为 0 时原样返回,不悄悄改数据', () => {
  const w = 5, h = 5;
  const px = makeImage(w, h, [255, 255, 255], { x0: 2, y0: 2, x1: 2, y1: 2, color: [0, 0, 0] });
  const hard = buildAlphaMask(px, w, h, { tolerance: 10 });
  assert.deepEqual(Array.from(featherMask(hard, w, h, 0)), Array.from(hard));
});

// ── 服务端 mask 的读法 ─────────────────────────────────────────────────────
// 服务端(isnet)回来的是一张 PNG。它可能是**灰度**(主体白、背景黑,alpha 全 255),
// 也可能是**带 alpha 的 RGBA**(主体不透明、背景透明)。两种都要读对 —— 读错的表现
// 是「整张图全透明」或「抠图完全没生效」,而不会报错。

function rgba(pixels: [number, number, number, number][]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach(([r, g, b, a], i) => {
    out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = b; out[i * 4 + 3] = a;
  });
  return out;
}

test('带 alpha 的 mask:直接用 alpha 通道', () => {
  const alpha = alphaFromMaskPixels(rgba([
    [255, 255, 255, 0],
    [255, 255, 255, 128],
    [255, 255, 255, 255],
  ]));
  assert.deepEqual([...alpha], [0, 128, 255]);
});

test('灰度 mask(alpha 全 255):用亮度,黑=背景 白=主体', () => {
  const alpha = alphaFromMaskPixels(rgba([
    [0, 0, 0, 255],
    [128, 128, 128, 255],
    [255, 255, 255, 255],
  ]));
  assert.equal(alpha[0], 0, '黑 = 背景 = 透明');
  assert.equal(alpha[2], 255, '白 = 主体 = 不透明');
  assert.ok(alpha[1]! > 100 && alpha[1]! < 160, '中间灰给半透明边缘');
});

test('空 mask 给空结果,不抛', () => {
  assert.equal(alphaFromMaskPixels(new Uint8ClampedArray(0)).length, 0);
});
