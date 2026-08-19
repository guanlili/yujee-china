import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ImageGenError } from '@/lib/imagegen/types';
import {
  FREE_RETRIES_PER_GENERATION,
  GenerateImageBodySchema,
  canRetryFree,
  outcomeForError,
} from './image-generation-util';

test('描述必填且有长度上限 —— 空描述会白扣用户一分', () => {
  assert.equal(GenerateImageBodySchema.safeParse({ prompt: '', width: 794, height: 1123 }).success, false);
  assert.equal(GenerateImageBodySchema.safeParse({ prompt: '   ', width: 794, height: 1123 }).success, false);
  assert.equal(
    GenerateImageBodySchema.safeParse({ prompt: 'x'.repeat(5000), width: 794, height: 1123 }).success,
    false,
  );
});

test('宽高必须是正整数且有上限 —— 尺寸直接决定上游账单', () => {
  assert.equal(GenerateImageBodySchema.safeParse({ prompt: 'a', width: 0, height: 100 }).success, false);
  assert.equal(GenerateImageBodySchema.safeParse({ prompt: 'a', width: 794, height: -1 }).success, false);
  assert.equal(GenerateImageBodySchema.safeParse({ prompt: 'a', width: 99999, height: 99999 }).success, false);
  assert.equal(GenerateImageBodySchema.safeParse({ prompt: 'a', width: 794, height: 1123 }).success, true);
});

test('多余字段被拒 —— 别让客户端塞 photoId 之类的东西进来', () => {
  const parsed = GenerateImageBodySchema.safeParse({
    prompt: 'a', width: 794, height: 1123, photoId: 'injected',
  });
  assert.equal(parsed.success, false);
});

test('免费重生成:没用过就免费', () => {
  assert.equal(canRetryFree({ freeRetriesUsed: 0 }), true);
});

test('免费重生成:用满了就不免费 —— 次数是按毛利算出来的,不能超', () => {
  assert.equal(canRetryFree({ freeRetriesUsed: FREE_RETRIES_PER_GENERATION }), false);
  assert.equal(canRetryFree({ freeRetriesUsed: FREE_RETRIES_PER_GENERATION + 5 }), false);
});

test('安全拒绝要退钱,而且不消耗免费次数 —— 否则用户被策略拦一次就白掉一次机会', () => {
  const outcome = outcomeForError(new ImageGenError('safety', 'blocked'));
  assert.equal(outcome.refund, true);
  assert.equal(outcome.consumesFreeRetry, false);
  assert.equal(outcome.retryable, false);
});

test('上游故障要退钱,可重试,也不消耗免费次数', () => {
  const outcome = outcomeForError(new ImageGenError('upstream', '502'));
  assert.equal(outcome.refund, true);
  assert.equal(outcome.consumesFreeRetry, false);
  assert.equal(outcome.retryable, true);
});

test('非 ImageGenError 的意外异常也一律退钱 —— 钱扣了图没出是最伤用户的情况', () => {
  const outcome = outcomeForError(new Error('r2 exploded'));
  assert.equal(outcome.refund, true);
});
