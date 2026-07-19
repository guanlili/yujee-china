import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBoardBackground, IMAGE_PRESETS } from './presets';

test('normalizeBoardBackground: 纯色仅接受合法 hex', () => {
  assert.deepEqual(normalizeBoardBackground({ kind: 'color', color: '#1c1b18' }), { kind: 'color', color: '#1c1b18' });
  assert.deepEqual(normalizeBoardBackground({ kind: 'color', color: '#fff' }), { kind: 'color', color: '#fff' });
  assert.equal(normalizeBoardBackground({ kind: 'color', color: 'red' }), null);
  assert.equal(normalizeBoardBackground({ kind: 'color', color: '#12' }), null);
});

test('normalizeBoardBackground: 预设仅接受已知 id', () => {
  const known = IMAGE_PRESETS[0]!.id;
  assert.deepEqual(normalizeBoardBackground({ kind: 'preset', presetId: known }), { kind: 'preset', presetId: known });
  assert.equal(normalizeBoardBackground({ kind: 'preset', presetId: 'nope' }), null);
});

test('normalizeBoardBackground: 上传图接受非空 key(≤64),否则回落 null', () => {
  assert.deepEqual(
    normalizeBoardBackground({ kind: 'upload', key: 'abc-123' }),
    { kind: 'upload', key: 'abc-123' },
  );
  assert.equal(normalizeBoardBackground({ kind: 'upload', key: '' }), null);
  assert.equal(normalizeBoardBackground({ kind: 'upload', key: 'x'.repeat(65) }), null);
  assert.equal(normalizeBoardBackground({ kind: 'upload' }), null);
});

test('normalizeBoardBackground: 垃圾/未知 kind → null(当无背景)', () => {
  assert.equal(normalizeBoardBackground(null), null);
  assert.equal(normalizeBoardBackground('x'), null);
  assert.equal(normalizeBoardBackground({ kind: 'weird' }), null);
});
