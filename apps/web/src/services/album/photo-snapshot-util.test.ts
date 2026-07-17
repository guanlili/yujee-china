import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PHOTO_SNAPSHOT_MAX_COUNT,
  isValidPhotoId,
  photoSnapshotKey,
  mergeSnapshotPhotoIds,
  photoSnapshotUrls,
} from './photo-snapshot-util';

test('isValidPhotoId accepts uuids, rejects path-traversal / cross-namespace input', () => {
  assert.equal(isValidPhotoId('550e8400-e29b-41d4-a716-446655440000'), true);
  assert.equal(isValidPhotoId('p1'), true);
  // 杜绝路径穿越 / 跨命名空间 / 注入
  assert.equal(isValidPhotoId('../other-album/secret'), false);
  assert.equal(isValidPhotoId('a/b'), false);
  assert.equal(isValidPhotoId('a.jpg'), false);
  assert.equal(isValidPhotoId(''), false);
  assert.equal(isValidPhotoId('x'.repeat(65)), false);
  assert.equal(isValidPhotoId(123), false);
  assert.equal(isValidPhotoId(null), false);
});

test('photoSnapshotKey uses the {userId}/{albumId}/{photoId} namespace', () => {
  assert.equal(photoSnapshotKey('u1', 'a1', 'p1'), 'photo-snapshots/u1/a1/p1.jpg');
});

test('mergeSnapshotPhotoIds dedups and keeps existing-first order', () => {
  assert.deepEqual(mergeSnapshotPhotoIds(['a', 'b'], ['b', 'c']), ['a', 'b', 'c']);
  assert.deepEqual(mergeSnapshotPhotoIds(undefined, ['a', 'a', 'b']), ['a', 'b']);
  assert.deepEqual(mergeSnapshotPhotoIds(['a'], []), ['a']);
});

test('photoSnapshotUrls derives per-photo urls and skips invalid ids', () => {
  const publicUrl = (key: string) => `https://cdn.test/${key}`;
  assert.deepEqual(photoSnapshotUrls('u1', 'a1', ['p1', 'p2'], publicUrl), {
    p1: 'https://cdn.test/photo-snapshots/u1/a1/p1.jpg',
    p2: 'https://cdn.test/photo-snapshots/u1/a1/p2.jpg',
  });
  // 脏 id 不生成 URL(防止 detail 把非法 key 泄给客户端)
  assert.deepEqual(photoSnapshotUrls('u1', 'a1', ['ok', '../evil'], publicUrl), {
    ok: 'https://cdn.test/photo-snapshots/u1/a1/ok.jpg',
  });
  assert.deepEqual(photoSnapshotUrls('u1', 'a1', undefined, publicUrl), {});
});

test('PHOTO_SNAPSHOT_MAX_COUNT is a sane per-save cap', () => {
  assert.ok(PHOTO_SNAPSHOT_MAX_COUNT >= 100 && PHOTO_SNAPSHOT_MAX_COUNT <= 1000);
});
