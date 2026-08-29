import assert from 'node:assert/strict';
import test from 'node:test';

import { bestInkFor, contrastRatio, meetsAA } from './contrast';
import { THIRD_SET_INK } from './third-set-palette';

test('黑白对比度是 21:1', () => {
  assert.ok(Math.abs(contrastRatio('#000000', '#FFFFFF') - 21) < 0.01);
});

test('对比度与参数顺序无关', () => {
  assert.equal(contrastRatio('#2D6DB0', '#F5F2E8'), contrastRatio('#F5F2E8', '#2D6DB0'));
});

test('支持 #RGB 简写', () => {
  assert.equal(contrastRatio('#000', '#fff'), contrastRatio('#000000', '#FFFFFF'));
});

test('meetsAA 卡在 4.5', () => {
  // 蓝底浅字 4.78 达标；橙原稿 #E8481C 配浅字 3.49 不达标（见 third-set-palette 注释）
  assert.equal(meetsAA('#2D6DB0', '#F5F2E8'), true);
  assert.equal(meetsAA('#E8481C', '#F5F2E8'), false);
});

test('bestInkFor 按两色规则选字色：深底浅字、浅底深字', () => {
  assert.equal(bestInkFor('#2D6DB0'), THIRD_SET_INK.light);
  assert.equal(bestInkFor('#F3F0A8'), THIRD_SET_INK.dark);
  assert.equal(bestInkFor('#FFFFFF'), THIRD_SET_INK.dark);
});
