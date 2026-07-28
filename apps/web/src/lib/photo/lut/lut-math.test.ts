import assert from 'node:assert/strict';
import test from 'node:test';
import { sampleLutTrilinear } from './lut-math';

function identityLut(size: number): Uint8Array {
  const data = new Uint8Array(size ** 3 * 3);
  let offset = 0;
  for (let b = 0; b < size; b += 1) {
    for (let g = 0; g < size; g += 1) {
      for (let r = 0; r < size; r += 1) {
        data[offset++] = Math.round((r / (size - 1)) * 255);
        data[offset++] = Math.round((g / (size - 1)) * 255);
        data[offset++] = Math.round((b / (size - 1)) * 255);
      }
    }
  }
  return data;
}

test('identity LUT leaves RGB unchanged', () => {
  assert.deepEqual(
    sampleLutTrilinear(identityLut(2), 2, [0.25, 0.5, 0.75], 1),
    [0.25, 0.5, 0.75],
  );
});

test('strength zero returns the clamped original RGB', () => {
  const deliberatelyDifferent = new Uint8Array(2 ** 3 * 3).fill(255);
  assert.deepEqual(
    sampleLutTrilinear(deliberatelyDifferent, 2, [-0.25, 0.4, 1.25], 0),
    [0, 0.4, 1],
  );
});

test('trilinear sampling addresses RGB-fastest corners and interpolates all axes', () => {
  const lut = new Uint8Array(2 ** 3 * 3);
  let offset = 0;
  for (let b = 0; b < 2; b += 1) {
    for (let g = 0; g < 2; g += 1) {
      for (let r = 0; r < 2; r += 1) {
        lut[offset++] = r * 255;
        lut[offset++] = g * 255;
        lut[offset++] = b * 255;
      }
    }
  }

  assert.deepEqual(sampleLutTrilinear(lut, 2, [1, 0, 1], 1), [1, 0, 1]);
  assert.deepEqual(sampleLutTrilinear(lut, 2, [0.25, 0.5, 0.75], 0.5), [0.25, 0.5, 0.75]);
});

test('trilinear sampling mixes a non-identity interpolated LUT result with the original', () => {
  const lut = new Uint8Array(2 ** 3 * 3);
  let offset = 0;
  for (let b = 0; b < 2; b += 1) {
    for (let g = 0; g < 2; g += 1) {
      for (let r = 0; r < 2; r += 1) {
        lut[offset++] = b * 255;
        lut[offset++] = r * 255;
        lut[offset++] = g * 255;
      }
    }
  }

  const result = sampleLutTrilinear(lut, 2, [0.2, 0.4, 0.8], 0.25);
  assert.ok(Math.abs(result[0] - 0.35) < 1e-12);
  assert.ok(Math.abs(result[1] - 0.35) < 1e-12);
  assert.ok(Math.abs(result[2] - 0.7) < 1e-12);
});
