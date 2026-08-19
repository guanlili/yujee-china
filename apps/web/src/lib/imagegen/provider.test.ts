import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveImageProvider } from './provider';

test('按 IMAGE_PROVIDER 选家', () => {
  assert.equal(resolveImageProvider({ IMAGE_PROVIDER: 'gemini', GEMINI_API_KEY: 'g' })?.name, 'gemini');
  assert.equal(resolveImageProvider({ IMAGE_PROVIDER: 'ark', ARK_API_KEY: 'a' })?.name, 'ark');
});

test('选中的那家没有 key 就返回 null —— 生图入口据此关掉,而不是运行时炸', () => {
  assert.equal(resolveImageProvider({ IMAGE_PROVIDER: 'gemini' }), null);
  assert.equal(resolveImageProvider({ IMAGE_PROVIDER: 'ark' }), null);
});

test('不回落到另一家 —— 生产误配了 key 也不能悄悄把用户的图发去另一个国家', () => {
  assert.equal(resolveImageProvider({ IMAGE_PROVIDER: 'gemini', ARK_API_KEY: 'a' }), null);
  assert.equal(resolveImageProvider({ IMAGE_PROVIDER: 'ark', GEMINI_API_KEY: 'g' }), null);
});
