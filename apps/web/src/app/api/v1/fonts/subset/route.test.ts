import assert from 'node:assert/strict';
import test from 'node:test';

import { FontSubsetBodySchema } from './schema';

test('font subset body accepts up to three unique closed-manifest CJK ids', () => {
  const parsed = FontSubsetBodySchema.safeParse({
    charset: '遇己 Album',
    fontIds: ['long-cang', 'smiley-sans', 'noto-serif-sc'],
  });
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.deepEqual(parsed.data.fontIds, ['long-cang', 'smiley-sans', 'noto-serif-sc']);
  }

  assert.equal(
    FontSubsetBodySchema.safeParse({ charset: '遇己', fontIds: ['comic-sans'] }).success,
    false,
  );
  assert.equal(
    FontSubsetBodySchema.safeParse({
      charset: '遇己',
      fontIds: ['long-cang', 'smiley-sans', 'lxgw-wenkai', 'zhi-mang-xing'],
    }).success,
    false,
  );
  assert.equal(
    FontSubsetBodySchema.safeParse({ charset: '遇己', fontIds: ['long-cang', 'long-cang'] }).success,
    false,
  );
});

test('font subset body preserves the charset-only backward-compatible request', () => {
  const parsed = FontSubsetBodySchema.parse({ charset: '遇己' });
  assert.deepEqual(parsed, { charset: '遇己', fontIds: [] });
});
