import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyTransferFailure } from '@/lib/analytics/failure-code';

// 这条测试守的是隐私红线,不是"分类准不准":任何输入都不能回落到原文。
// 真实事故场景:PUT 预签名 URL 失败时 message 里带着 q-signature,一旦透传就进库了。

test('http status wins and stays a closed token', () => {
  assert.equal(classifyTransferFailure(Object.assign(new Error('boom'), { status: 403 })), 'http_403');
  assert.equal(classifyTransferFailure({ status: 500 }), 'http_500');
});

test('network-shaped messages collapse to network, never to the raw message', () => {
  assert.equal(classifyTransferFailure(new Error('Failed to fetch')), 'network');
  assert.equal(classifyTransferFailure(new Error('net::ERR_ABORTED')), 'network');
  assert.equal(classifyTransferFailure(new Error('load failed')), 'network');
});

test('unknown errors fall back to other', () => {
  assert.equal(classifyTransferFailure(new Error('something odd')), 'other');
  assert.equal(classifyTransferFailure(undefined), 'other');
  assert.equal(classifyTransferFailure('a bare string'), 'other');
});

test('never leaks a presigned URL or signature', () => {
  const signed =
    'PUT https://cos.ap-beijing.myqcloud.com/photos/1.jpg?q-sign-algorithm=sha1&q-signature=SECRET&token=abc failed';
  const code = classifyTransferFailure(new Error(signed));
  assert.doesNotMatch(code, /signature|SECRET|token|cos\./i, 'failure code must not carry request material');
  assert.doesNotMatch(code, /https?:/);
});

test('non-finite status is not accepted as an http code', () => {
  assert.equal(classifyTransferFailure({ status: Number.NaN }), 'other');
});
