import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCutoutEngineForTesting } from './engine';

/** 一张 9×9:白底,中间 3×3 深色方块。 */
function fakeImageData() {
  const w = 9, h = 9;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const solid = x >= 3 && x <= 5 && y >= 3 && y <= 5;
      const i = (y * w + x) * 4;
      const v = solid ? 10 : 255;
      data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}

function harness(over: Record<string, unknown> = {}) {
  const state = { encoded: null as null | { type: string }, put: null as null | Uint8ClampedArray };
  const engine = createCutoutEngineForTesting({
    decodeBlob: async () => ({ width: 9, height: 9, close() {} }),
    createCanvas: () => ({
      width: 0,
      height: 0,
      drawImage() {},
      getImageData: () => fakeImageData(),
      putImageData: (img: { data: Uint8ClampedArray }) => { state.put = img.data; },
      encode: async (type: string) => { state.encoded = { type }; return new Blob([new Uint8Array([1])], { type }); },
      dispose() {},
    }),
    ...over,
  });
  return { engine, state };
}

test('抠完的产物编码成带 alpha 的 WebP —— JPEG 装不下 alpha', async () => {
  const { engine, state } = harness();
  const out = await engine.applyToBlob(new Blob([new Uint8Array([0])]));
  assert.equal(state.encoded?.type, 'image/webp');
  assert.equal(out.type, 'image/webp');
});

test('背景像素的 alpha 被打到 0,主体保持不透明', async () => {
  const { engine, state } = harness();
  await engine.applyToBlob(new Blob([new Uint8Array([0])]));
  const data = state.put!;
  const alphaAt = (x: number, y: number) => data[(y * 9 + x) * 4 + 3]!;
  assert.equal(alphaAt(0, 0), 0, '角落应透明');
  assert.equal(alphaAt(4, 4), 255, '主体中心应不透明');
});

test('画布拿不到就原样退回原图 —— 抠不了也不能把用户的照片弄丢', async () => {
  const { engine } = harness({ createCanvas: () => null });
  const original = new Blob([new Uint8Array([7])], { type: 'image/jpeg' });
  const out = await engine.applyToBlob(original);
  assert.equal(out, original);
});

test('解码失败也退回原图,不抛给调用方', async () => {
  const { engine } = harness({
    decodeBlob: async () => { throw new Error('decode blew up'); },
  });
  const original = new Blob([new Uint8Array([7])], { type: 'image/jpeg' });
  const out = await engine.applyToBlob(original);
  assert.equal(out, original);
});
