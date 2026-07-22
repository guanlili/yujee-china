import assert from 'node:assert/strict';
import test from 'node:test';

import { splitBox } from './split-spread-canvas';

// 纯几何,不依赖 DOM:双宽画布从正中切两半,左右各占一半宽、全高。
test('splitBox halves the width and keeps the height', () => {
  assert.deepEqual(splitBox(1588, 1123), [
    { sx: 0, sy: 0, sw: 794, sh: 1123 },
    { sx: 794, sy: 0, sw: 794, sh: 1123 },
  ]);
});

test('splitBox handles an odd width without losing a column', () => {
  const [left, right] = splitBox(1589, 1123);
  assert.equal(left.sw + right.sw, 1589);
  assert.equal(right.sx, left.sw);
});
