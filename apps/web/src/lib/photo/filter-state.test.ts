import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LUT_DEFINITIONS,
  PhotoFilterStateSchema,
  effectiveRenderVersion,
  isCutout,
  normalizePhotoFilterState,
  resolveEffectiveFilter,
  toggleCutout,
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

// ── 抠图(cutout)派生状态 ──────────────────────────────────────────────────
// 抠图和 LUT 同属「每张照片的派生像素状态」,所以共用 albums.photo_filter 这一列:
// 一个真相源、一次行锁、一个 normalize,且不动 Page 契约、不加迁移。

test('cutouts 是可选字段,存量行(没有这个键)照常 parse', () => {
  const legacy = PhotoFilterStateSchema.parse({ default: null });
  assert.equal(legacy.cutouts, undefined);
  assert.equal(isCutout(legacy, 'p1'), false);
});

test('cutouts 只认 true —— 关掉抠图要删键,不能写 false', () => {
  const state = PhotoFilterStateSchema.parse({ default: null, cutouts: { p1: true } });
  assert.equal(isCutout(state, 'p1'), true);
  assert.equal(isCutout(state, 'p2'), false);
  // 允许 false 会让「没抠」有两种表示,renderVersion 和缓存 key 立刻产生歧义。
  assert.throws(() => PhotoFilterStateSchema.parse({ default: null, cutouts: { p1: false } }));
});

test('抠图给 renderVersion 追加 __cut1,pf-v1 前缀和存量版本串逐字不变', () => {
  const noLut = PhotoFilterStateSchema.parse({ default: null, cutouts: { p1: true } });
  assert.equal(effectiveRenderVersion(noLut, 'p1'), 'pf-v1__original__cut1');
  // 同一份 state 里没抠的照片,版本串必须和加 cutouts 之前完全一样 —— 否则存量分享全 409。
  assert.equal(effectiveRenderVersion(noLut, 'p2'), 'pf-v1__original');

  const withLut = PhotoFilterStateSchema.parse({
    default: { lutId: 'fuji-portrait', strength: 82 },
    cutouts: { p1: true },
  });
  assert.equal(effectiveRenderVersion(withLut, 'p1'), 'pf-v1__fuji-portrait__80__cut1');
  assert.equal(effectiveRenderVersion(withLut, 'p2'), 'pf-v1__fuji-portrait__80');
});

test('显式 null override(强制原片)叠抠图,仍是 original__cut1', () => {
  const state = PhotoFilterStateSchema.parse({
    default: { lutId: 'fuji-portrait', strength: 82 },
    overrides: { p1: null },
    cutouts: { p1: true },
  });
  assert.equal(effectiveRenderVersion(state, 'p1'), 'pf-v1__original__cut1');
});

test('normalizePhotoFilterState 必须原样保留 cutouts,不能顺手丢掉', () => {
  const normalized = normalizePhotoFilterState({
    default: { lutId: 'fuji-portrait', strength: 82 },
    cutouts: { p1: true },
  });
  assert.deepEqual(normalized?.cutouts, { p1: true });
  assert.equal(normalized?.default?.strength, 80);
});

test('toggleCutout: 开抠图只加键,不动 LUT 部分', () => {
  const base = { default: { lutId: 'retro-film' as const, strength: 60 }, overrides: {} };
  const next = toggleCutout(base, 'p1');
  assert.equal(isCutout(next, 'p1'), true);
  assert.deepEqual(next.default, base.default, 'LUT 不该被抠图开关碰到');
});

test('toggleCutout: 关抠图是删键,不是写 false —— 写 false 会让「没抠」有两种表示', () => {
  const on = toggleCutout({ default: null }, 'p1');
  const off = toggleCutout(on, 'p1');
  assert.equal(isCutout(off, 'p1'), false);
  assert.equal(Object.hasOwn(off.cutouts ?? {}, 'p1'), false, 'p1 应当被删掉而不是置 false');
});

test('toggleCutout: 只影响那一张,别的照片的抠图状态不动', () => {
  const two = toggleCutout(toggleCutout({ default: null }, 'p1'), 'p2');
  const off = toggleCutout(two, 'p1');
  assert.equal(isCutout(off, 'p1'), false);
  assert.equal(isCutout(off, 'p2'), true);
});

test('toggleCutout: 全关之后不留空的 cutouts 壳 —— 空对象会让存库 JSON 多一层噪音', () => {
  const on = toggleCutout({ default: null }, 'p1');
  const off = toggleCutout(on, 'p1');
  assert.equal(off.cutouts, undefined);
});
