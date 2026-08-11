import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isNotFound } from './r2-client';

test('isNotFound: SDK 的 NoSuchKey / NotFound 算「不存在」', () => {
  assert.equal(isNotFound(Object.assign(new Error('x'), { name: 'NoSuchKey' })), true);
  assert.equal(isNotFound(Object.assign(new Error('x'), { name: 'NotFound' })), true);
});

test('isNotFound: 只带 404 状态码的响应也算', () => {
  assert.equal(isNotFound({ $metadata: { httpStatusCode: 404 } }), true);
});

test('isNotFound: 403 / 503 / 网络错误都不算 —— 这些必须上抛,不能伪装成缺图', () => {
  assert.equal(isNotFound({ $metadata: { httpStatusCode: 403 } }), false);
  assert.equal(isNotFound({ $metadata: { httpStatusCode: 503 } }), false);
  assert.equal(isNotFound(Object.assign(new Error('socket hang up'), { name: 'Error' })), false);
  assert.equal(isNotFound(new Error('boom')), false);
});

test('isNotFound: 非对象输入不炸', () => {
  assert.equal(isNotFound(null), false);
  assert.equal(isNotFound(undefined), false);
  assert.equal(isNotFound('NoSuchKey'), false);
});
