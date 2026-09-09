import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  photoMaskKey,
  photoOriginalKey, PhotoOriginalEntriesBodySchema,
  PhotoOriginalConfirmBodySchema, PhotoOriginalUrlsBodySchema,
} from './photo-original-util';

test('photoOriginalKey shape and validation', () => {
  assert.equal(photoOriginalKey('a1', 'p1'), 'photo-originals/a1/p1.jpg');
  assert.throws(() => photoOriginalKey('a1', '../etc'), (e: { code?: string }) => e.code === 'VALIDATION_FAILED');
});

test('entries body rejects dup photoId and >300', () => {
  const entry = (id: string) => ({ photoId: id, width: 10, height: 10, bytes: 100 });
  assert.equal(PhotoOriginalEntriesBodySchema.safeParse({ entries: [entry('p1'), entry('p1')] }).success, false);
  assert.equal(PhotoOriginalEntriesBodySchema.safeParse({ entries: Array.from({ length: 301 }, (_, i) => entry(`p${i}`)) }).success, false);
  assert.equal(PhotoOriginalEntriesBodySchema.safeParse({ entries: [entry('p1')] }).success, true);
});

test('confirm body needs at least one of entries/missing', () => {
  assert.equal(PhotoOriginalConfirmBodySchema.safeParse({}).success, false);
  assert.equal(PhotoOriginalConfirmBodySchema.safeParse({ missing: ['p1'] }).success, true);
});

test('urls body validates photoIds', () => {
  assert.equal(PhotoOriginalUrlsBodySchema.safeParse({ photoIds: [] }).success, false);
  assert.equal(PhotoOriginalUrlsBodySchema.safeParse({ photoIds: ['ok-id'] }).success, true);
});

// FINDING 3(a): bytes cap boundary
test('bytes cap boundary - 30MB passes, 30MB+1 fails', () => {
  const entry30MB = { photoId: 'p1', width: 10, height: 10, bytes: 30 * 1024 * 1024 };
  const entry30MBPlus1 = { photoId: 'p1', width: 10, height: 10, bytes: 30 * 1024 * 1024 + 1 };
  assert.equal(PhotoOriginalEntriesBodySchema.safeParse({ entries: [entry30MB] }).success, true);
  assert.equal(PhotoOriginalEntriesBodySchema.safeParse({ entries: [entry30MBPlus1] }).success, false);
});

// FINDING 3(b): exact boundary 300 passes for entries body and urls body
test('exact boundary 300 passes for entries body', () => {
  const entry = (id: string) => ({ photoId: id, width: 10, height: 10, bytes: 100 });
  const entries300 = Array.from({ length: 300 }, (_, i) => entry(`p${i}`));
  assert.equal(PhotoOriginalEntriesBodySchema.safeParse({ entries: entries300 }).success, true);
});

test('exact boundary 300 passes for urls body', () => {
  const urls300 = Array.from({ length: 300 }, (_, i) => `p${i}`);
  assert.equal(PhotoOriginalUrlsBodySchema.safeParse({ photoIds: urls300 }).success, true);
});

// FINDING 3(c): cross-array dedup in ConfirmBodySchema
test('cross-array dedup in ConfirmBodySchema - same photoId in entries and missing rejected', () => {
  const entry = { photoId: 'p1', width: 10, height: 10, bytes: 100 };
  const result = PhotoOriginalConfirmBodySchema.safeParse({
    entries: [entry],
    missing: ['p1'],
  });
  assert.equal(result.success, false);
});

// FINDING 3(d): entries empty array with non-empty missing accepted
test('entries empty array with non-empty missing accepted', () => {
  const result = PhotoOriginalConfirmBodySchema.safeParse({
    entries: [],
    missing: ['p1'],
  });
  assert.equal(result.success, true);
});

// FINDING 3(e): missing with invalid photoId rejected
test('missing with invalid photoId rejected', () => {
  const result = PhotoOriginalConfirmBodySchema.safeParse({
    missing: ['../etc'],
  });
  assert.equal(result.success, false);
});

// ── 抠图 mask 的 R2 key ────────────────────────────────────────────────────
// 与原图同一套推导规则:key 由 (albumId, photoId) 算出来,任何调用方都给不了 key。
test('photoMaskKey 由 (albumId, photoId) 推导,并挡住非法 photoId', () => {
  assert.equal(
    photoMaskKey('album-1', '550e8400-e29b-41d4-a716-446655440000'),
    'photo-masks/album-1/550e8400-e29b-41d4-a716-446655440000.png',
  );
  // 路径穿越 / 跨命名空间的 id 一律拒 —— 与 photoOriginalKey 同一条闸。
  for (const bad of ['../evil', 'a/b', '', 'x'.repeat(200)]) {
    assert.throws(() => photoMaskKey('album-1', bad), /invalid photoId/i, `${bad} 应被拒`);
  }
});
