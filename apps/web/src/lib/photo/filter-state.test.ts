import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LUT_DEFINITIONS,
  PhotoFilterStateSchema,
  effectiveRenderVersion,
  resolveEffectiveFilter,
} from './filter-state';

test('manifest 固定为 26 个唯一稳定 id', () => {
  assert.equal(LUT_DEFINITIONS.length, 26);
  assert.equal(new Set(LUT_DEFINITIONS.map((x) => x.id)).size, 26);
});

test('显式 null override 强制原片且版本稳定', () => {
  const state = PhotoFilterStateSchema.parse({
    default: { lutId: 'fuji-portrait', strength: 82 },
    overrides: { p1: null },
  });
  assert.equal(resolveEffectiveFilter(state, 'p1'), null);
  assert.equal(effectiveRenderVersion(state, 'p1'), 'pf-v1__original');
  assert.equal(effectiveRenderVersion(state, 'p2'), 'pf-v1__fuji-portrait__80');
});

test('拒绝未知 lutId、越界强度和多余字段', () => {
  assert.equal(PhotoFilterStateSchema.safeParse({ default: { lutId: 'unknown', strength: 80 } }).success, false);
  assert.equal(PhotoFilterStateSchema.safeParse({ default: { lutId: 'fuji-portrait', strength: 101 } }).success, false);
  assert.equal(PhotoFilterStateSchema.safeParse({ default: null, extra: true }).success, false);
});
