import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
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
