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

// ── 服务端 mask 优先 ───────────────────────────────────────────────────────
// 漫水填充没有语义(2026-08-29 验证否决)。真正能用的是服务端 isnet 的分割 mask;
// 这个引擎负责把那张 PNG 的 alpha 贴到照片上。**mask 与照片尺寸经常不同**
// (mask 是 1024² 推理出来的),所以必须缩放到照片尺寸再取像素。

/** 一张 3×3 的 mask:左列透明、右列不透明。 */
function fakeMaskData(w = 9, h = 9) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      data[i] = 255; data[i + 1] = 255; data[i + 2] = 255;
      data[i + 3] = x < w / 2 ? 0 : 255;
    }
  }
  return { data, width: w, height: h };
}

function maskHarness(over: Record<string, unknown> = {}) {
  const state = {
    encoded: null as null | { type: string },
    put: null as null | Uint8ClampedArray,
    /** 每次 drawImage 的实参:检验 mask 真的被缩放到照片尺寸。 */
    draws: [] as Array<{ w: number; h: number; scaled?: [number, number] }>,
    canvases: 0,
  };
  let canvasIndex = 0;
  const engine = createCutoutEngineForTesting({
    // 第一个 blob 是照片(9×9),第二个是 mask(3×3)。
    decodeBlob: async (blob: Blob) =>
      blob.type === 'image/png'
        ? { width: 3, height: 3, close() {} }
        : { width: 9, height: 9, close() {} },
    createCanvas: () => {
      const mine = canvasIndex++;
      state.canvases += 1;
      const canvas = {
        width: 0,
        height: 0,
        drawImage(bitmap: { width: number; height: number }, w?: number, h?: number) {
          state.draws.push({ w: bitmap.width, h: bitmap.height, ...(w !== undefined && h !== undefined ? { scaled: [w, h] as [number, number] } : {}) });
        },
        // 0 号画布装照片,1 号装 mask。
        getImageData: () => (mine === 0 ? fakeImageData() : fakeMaskData()),
        putImageData: (img: { data: Uint8ClampedArray }) => { state.put = img.data; },
        encode: async (type: string) => { state.encoded = { type }; return new Blob([new Uint8Array([1])], { type }); },
        dispose() {},
      };
      return canvas;
    },
    ...over,
  });
  return { engine, state };
}

const photoBlob = () => new Blob([new Uint8Array([0])], { type: 'image/jpeg' });
const maskBlob = () => new Blob([new Uint8Array([1])], { type: 'image/png' });

test('applyMaskToBlob 用 mask 的 alpha 覆盖照片 alpha,产物仍是 WebP', async () => {
  const { engine, state } = maskHarness();
  const out = await engine.applyMaskToBlob(photoBlob(), maskBlob());
  assert.equal(out.type, 'image/webp');
  const data = state.put!;
  const alphaAt = (x: number, y: number) => data[(y * 9 + x) * 4 + 3]!;
  assert.equal(alphaAt(0, 0), 0, 'mask 左半 = 透明');
  assert.equal(alphaAt(8, 0), 255, 'mask 右半 = 不透明');
  // 关键:主体中心(漫水填充会判成主体)在 mask 里落在左半,必须听 mask 的。
  assert.equal(alphaAt(1, 4), 0, 'alpha 必须来自 mask,不是漫水填充的判断');
});

test('mask 尺寸与照片不同时缩放到照片尺寸 —— 否则错位一大片', async () => {
  const { engine, state } = maskHarness();
  await engine.applyMaskToBlob(photoBlob(), maskBlob());
  const maskDraw = state.draws.find((d) => d.w === 3);
  assert.ok(maskDraw, 'mask 应被画进画布');
  assert.deepEqual(maskDraw.scaled, [9, 9], 'mask 必须缩放到照片尺寸');
});

test('mask 解不开时原样退回入参,绝不抛(与 applyToBlob 同一条契约)', async () => {
  const original = photoBlob();
  const { engine } = maskHarness({
    decodeBlob: async (blob: Blob) => {
      if (blob.type === 'image/png') throw new Error('mask decode blew up');
      return { width: 9, height: 9, close() {} };
    },
  });
  assert.equal(await engine.applyMaskToBlob(original, maskBlob()), original);
});

test('拿不到画布时原样退回入参', async () => {
  const original = photoBlob();
  const { engine } = maskHarness({ createCanvas: () => null });
  assert.equal(await engine.applyMaskToBlob(original, maskBlob()), original);
});
