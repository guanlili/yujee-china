import assert from 'node:assert/strict';
import test from 'node:test';
import { fitDisplayFontSize } from './constants';

test('fitDisplayFontSize: 短标题保持上限字号', () => {
  assert.equal(fitDisplayFontSize('North\nLight', 620, 96), 96);
});

test('fitDisplayFontSize: 长英文标题缩到盒宽内(My Memoir 曾在 300px 盒被裁)', () => {
  const size = fitDisplayFontSize('My Memoir', 620, 96);
  assert.equal(size, 96); // 620px 盒够宽,保持 96
  const narrow = fitDisplayFontSize('My Memoir', 300, 96);
  assert.ok(narrow < 96, `300px 盒应缩字,got ${narrow}`);
  // 视觉宽度约 5.58 全宽,缩后不超盒宽
  assert.ok(narrow * 5.6 <= 300 + narrow, `fitted ${narrow}`);
});

test('fitDisplayFontSize: CJK 记全宽,长中文标题明显缩小', () => {
  const size = fitDisplayFontSize('我们一家人的十二年时光', 400, 75, 32);
  assert.ok(size >= 32 && size <= 400 / 11 + 1, `got ${size}`);
});

test('fitDisplayFontSize: 不低于下限', () => {
  assert.equal(fitDisplayFontSize('超长超长超长超长超长超长超长超长超长超长', 300, 96, 44), 44);
});

test('fitDisplayFontSize: 空串安全返回上限', () => {
  assert.equal(fitDisplayFontSize('', 620, 96), 96);
});
