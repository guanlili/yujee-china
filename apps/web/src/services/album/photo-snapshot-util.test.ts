import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as snapshotUtil from './photo-snapshot-util';

const {
  PHOTO_SNAPSHOT_MAX_COUNT,
  isValidPhotoId,
  photoSnapshotKey,
  mergeSnapshotPhotoIds,
  photoSnapshotUrls,
} = snapshotUtil;

type SnapshotUtilV2 = typeof snapshotUtil & {
  isValidRenderVersion?: (value: unknown) => value is string;
  mergePhotoSnapshot?: (
    existingPhotoIds: string[] | undefined,
    existingRenderVersions: Record<string, string> | undefined,
    incoming: { photoId: string; renderVersion: string }[],
  ) => {
    photoIds: string[];
    renderVersions: Record<string, string>;
  };
  photoSnapshotRenderVersions?: (
    photoIds: string[] | undefined,
    renderVersions: Record<string, string> | undefined,
  ) => Record<string, string>;
};

const snapshotUtilV2 = snapshotUtil as SnapshotUtilV2;

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

test('photoSnapshotKey keeps the exact legacy key and derives immutable versioned keys', () => {
  assert.equal(photoSnapshotKey('u1', 'a1', 'p1'), 'photo-snapshots/u1/a1/p1.jpg');
  assert.equal(
    photoSnapshotKey('u1', 'a1', 'p1', 'pf-v1__fuji-portrait__80'),
    'photo-snapshots/u1/a1/p1/pf-v1__fuji-portrait__80.jpg',
  );
  assert.equal(
    photoSnapshotKey('u1', 'a1', 'p1', 'pf-v1__original'),
    'photo-snapshots/u1/a1/p1/pf-v1__original.jpg',
  );
});

test('mergeSnapshotPhotoIds dedups and keeps existing-first order', () => {
  assert.deepEqual(mergeSnapshotPhotoIds(['a', 'b'], ['b', 'c']), ['a', 'b', 'c']);
  assert.deepEqual(mergeSnapshotPhotoIds(undefined, ['a', 'a', 'b']), ['a', 'b']);
  assert.deepEqual(mergeSnapshotPhotoIds(['a'], []), ['a']);
});

test('render versions use the exact pf-v1 grammar and reject path/control strings', () => {
  const validate = snapshotUtilV2.isValidRenderVersion;
  assert.equal(typeof validate, 'function');
  assert.equal(validate?.('pf-v1__original'), true);
  assert.equal(validate?.('pf-v1__fuji-portrait__0'), true);
  assert.equal(validate?.('pf-v1__fuji-portrait__5'), true);
  assert.equal(validate?.('pf-v1__fuji-portrait__10'), true);
  assert.equal(validate?.('pf-v1__fuji-portrait__99'), true);
  assert.equal(validate?.('pf-v1__fuji-portrait__100'), true);

  for (const invalid of [
    '',
    'pf-v1__',
    'pf-v1__Fuji__80',
    'pf-v1__fuji_portrait__80',
    'pf-v1__fuji__04',
    'pf-v1__fuji__101',
    'pf-v1__../evil__80',
    'pf-v1__fuji/evil__80',
    'pf-v1__fuji__80\ninjected',
    'pf-v1__富士__80',
  ]) {
    assert.equal(validate?.(invalid), false, invalid);
  }
  assert.equal(validate?.(null), false);
});

test('photoSnapshotKey never concatenates an invalid render version', () => {
  assert.throws(
    () => photoSnapshotKey('u1', 'a1', 'p1', '../evil'),
    /invalid renderVersion/,
  );
  assert.throws(
    () => photoSnapshotKey('u1', 'a1', 'p1', 'pf-v1__ok__80\nbad'),
    /invalid renderVersion/,
  );
});

test('partial snapshot merge preserves untouched legacy/versioned photos and updates by photoId', () => {
  const merge = snapshotUtilV2.mergePhotoSnapshot;
  assert.equal(typeof merge, 'function');
  assert.deepEqual(
    merge?.(
      ['legacy', 'updated', 'untouched-versioned'],
      {
        updated: 'pf-v1__old-look__40',
        'untouched-versioned': 'pf-v1__daily-soft__60',
      },
      [
        { photoId: 'updated', renderVersion: 'pf-v1__fuji-portrait__80' },
        { photoId: 'new-photo', renderVersion: 'pf-v1__original' },
      ],
    ),
    {
      photoIds: ['legacy', 'updated', 'untouched-versioned', 'new-photo'],
      renderVersions: {
        updated: 'pf-v1__fuji-portrait__80',
        'untouched-versioned': 'pf-v1__daily-soft__60',
        'new-photo': 'pf-v1__original',
      },
    },
  );
});

test('photo snapshot URL resolution mixes legacy and versioned keys per photo', () => {
  const publicUrl = (key: string) => `https://cdn.test/${key}`;
  assert.deepEqual(photoSnapshotUrls('u1', 'a1', ['p1', 'p2'], publicUrl), {
    p1: 'https://cdn.test/photo-snapshots/u1/a1/p1.jpg',
    p2: 'https://cdn.test/photo-snapshots/u1/a1/p2.jpg',
  });
  assert.deepEqual(
    photoSnapshotUrls(
      'u1',
      'a1',
      ['legacy', 'filtered', 'original'],
      publicUrl,
      {
        filtered: 'pf-v1__fuji-portrait__80',
        original: 'pf-v1__original',
      },
    ),
    {
      legacy: 'https://cdn.test/photo-snapshots/u1/a1/legacy.jpg',
      filtered:
        'https://cdn.test/photo-snapshots/u1/a1/filtered/pf-v1__fuji-portrait__80.jpg',
      original: 'https://cdn.test/photo-snapshots/u1/a1/original/pf-v1__original.jpg',
    },
  );
  // 脏 id 不生成 URL(防止 detail 把非法 key 泄给客户端)
  assert.deepEqual(photoSnapshotUrls('u1', 'a1', ['ok', '../evil'], publicUrl), {
    ok: 'https://cdn.test/photo-snapshots/u1/a1/ok.jpg',
  });
  assert.deepEqual(photoSnapshotUrls('u1', 'a1', undefined, publicUrl), {});
});

test('corrupt stored render versions fall back to safe legacy keys and are not exposed', () => {
  const publicUrl = (key: string) => `https://cdn.test/${key}`;
  const stored = {
    safe: 'pf-v1__daily-soft__60',
    corrupt: '../../other-user/private',
    control: 'pf-v1__daily-soft__60\nx',
    orphan: 'pf-v1__original',
  };
  assert.deepEqual(
    photoSnapshotUrls('u1', 'a1', ['safe', 'corrupt', 'control'], publicUrl, stored),
    {
      safe: 'https://cdn.test/photo-snapshots/u1/a1/safe/pf-v1__daily-soft__60.jpg',
      corrupt: 'https://cdn.test/photo-snapshots/u1/a1/corrupt.jpg',
      control: 'https://cdn.test/photo-snapshots/u1/a1/control.jpg',
    },
  );

  const renderVersions = snapshotUtilV2.photoSnapshotRenderVersions;
  assert.equal(typeof renderVersions, 'function');
  assert.deepEqual(renderVersions?.(['safe', 'corrupt', 'control'], stored), {
    safe: 'pf-v1__daily-soft__60',
  });
});

test('PHOTO_SNAPSHOT_MAX_COUNT is a sane per-save cap', () => {
  assert.ok(PHOTO_SNAPSHOT_MAX_COUNT >= 100 && PHOTO_SNAPSHOT_MAX_COUNT <= 1000);
});

// ── 抠图 renderVersion 与快照扩展名 ───────────────────────────────────────
// 抠图产物带 alpha,JPEG 装不下。做法是给版本串追加 `__cut1` 尾段(不升 pf-v2 ——
// 升版本号会让所有存量快照一次性失配,每个已分享的相册都撞 409),快照 key 按尾段
// 决定扩展名,抠图走有损 WebP(带 alpha,体积与 JPEG 同量级,PNG 会大一个数量级)。

test('renderVersion 正则接受抠图尾段,存量版本串一个不落', () => {
  const { isValidRenderVersion } = snapshotUtil;
  assert.equal(isValidRenderVersion('pf-v1__original'), true);
  assert.equal(isValidRenderVersion('pf-v1__fuji-portrait__80'), true);
  assert.equal(isValidRenderVersion('pf-v1__original__cut1'), true);
  assert.equal(isValidRenderVersion('pf-v1__fuji-portrait__80__cut1'), true);
  assert.equal(isValidRenderVersion('pf-v1__original__cut2'), false);
  assert.equal(isValidRenderVersion('pf-v2__original'), false);
});

test('抠图版本的快照 key 走 .webp,未抠图仍是 .jpg', () => {
  assert.ok(photoSnapshotKey('u1', 'a1', 'p1', 'pf-v1__original').endsWith('/pf-v1__original.jpg'));
  assert.ok(
    photoSnapshotKey('u1', 'a1', 'p1', 'pf-v1__original__cut1')
      .endsWith('/pf-v1__original__cut1.webp'),
  );
});

test('legacy 无版本 key 不受影响,仍是 .jpg', () => {
  assert.equal(photoSnapshotKey('u1', 'a1', 'p1'), 'photo-snapshots/u1/a1/p1.jpg');
});
