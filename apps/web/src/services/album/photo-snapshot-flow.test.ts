import { test } from 'node:test';
import assert from 'node:assert/strict';

// R2 signing needs credentials; set them BEFORE importing anything that reads env
// (env.ts parses at import time). Dynamic imports below run after this.
process.env.R2_ACCOUNT_ID ??= 'test-account';
process.env.R2_ACCESS_KEY_ID ??= 'test-access-key';
process.env.R2_SECRET_ACCESS_KEY ??= 'test-secret-key';
process.env.R2_BUCKET ??= 'test-bucket';
process.env.R2_PUBLIC_BASE_URL ??= 'https://cdn.yujeeai.test';

const { db } = await import('../../db/client');
const { albumRepo } = await import('../../db/repos/album-repo');
const { albumPageRepo } = await import('../../db/repos/album-page-repo');
const { albumService } = await import('./album-service');
const { cleanupUser, isDbReachable, makeAlbum, makeUser } = await import(
  '../../db/repos/__test__/setup'
);

const P1 = '550e8400-e29b-41d4-a716-446655440001';
const P2 = '550e8400-e29b-41d4-a716-446655440002';
const P3 = '550e8400-e29b-41d4-a716-446655440003';

test('photo-snapshot sign: rejects empty / oversized / invalid photoIds, signs per-photo PUTs', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const user = await makeUser('photo-snap-sign');
  try {
    const album = await makeAlbum(user.id, { photoCount: 2 });

    await assert.rejects(
      () => albumService.signPhotoSnapshotUpload(user.id, album.id, []),
      (err: { code?: string }) => err.code === 'VALIDATION_FAILED',
    );
    // 路径穿越 / 跨命名空间的 photoId 必须被拒
    await assert.rejects(
      () => albumService.signPhotoSnapshotUpload(user.id, album.id, ['../evil']),
      (err: { code?: string }) => err.code === 'VALIDATION_FAILED',
    );

    const signed = await albumService.signPhotoSnapshotUpload(user.id, album.id, [P1, P2]);
    assert.equal(signed.length, 2);
    assert.equal(signed[0]!.photoId, P1);
    assert.equal(signed[0]!.r2Key, `photo-snapshots/${user.id}/${album.id}/${P1}.jpg`);
    assert.ok(signed[0]!.putUrl.startsWith('https://'));
    assert.ok(signed[0]!.publicUrl.endsWith(`photo-snapshots/${user.id}/${album.id}/${P1}.jpg`));
  } finally {
    await cleanupUser(user.id);
  }
});

test('photo-snapshot confirm: merges photoIds and getDetail exposes photoSnapshotUrls', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const user = await makeUser('photo-snap-confirm');
  try {
    const album = await makeAlbum(user.id, { photoCount: 3 });

    // detail 起手为空(未备份)
    const before = await albumService.getDetail(user.id, album.id);
    assert.deepEqual(before.album.photoSnapshotUrls, {});

    await albumService.confirmPhotoSnapshot(user.id, album.id, [P1, P2]);
    // 再存一次(含重复 + 新增)→ 去重合并
    const merged = await albumService.confirmPhotoSnapshot(user.id, album.id, [P2, P3]);
    assert.deepEqual(new Set(merged.photoIds), new Set([P1, P2, P3]));

    const row = await albumRepo.findById(album.id);
    assert.deepEqual(new Set(row?.photoSnapshot?.photoIds ?? []), new Set([P1, P2, P3]));
    assert.ok(row?.photoSnapshot?.updatedAt);

    const after = await albumService.getDetail(user.id, album.id);
    assert.ok(
      after.album.photoSnapshotUrls?.[P1]?.endsWith(
        `photo-snapshots/${user.id}/${album.id}/${P1}.jpg`,
      ),
    );
    assert.equal(Object.keys(after.album.photoSnapshotUrls ?? {}).length, 3);
  } finally {
    await cleanupUser(user.id);
  }
});

test('editing a COMPLETED album reverts its status to EDITING (photo-snapshot §5.5)', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const user = await makeUser('photo-snap-revert');
  try {
    const album = await makeAlbum(user.id, { photoCount: 1 });
    await albumRepo.update(db, album.id, { status: 'COMPLETED', pageCount: 1 });
    await albumPageRepo.bulkInsert(db, [
      {
        albumId: album.id,
        pageIndex: 0,
        templateId: 'mag-01',
        imagesJson: { hero: P1 },
        textsJson: { title: 'before' },
      },
    ]);

    await albumService.updatePage(user.id, album.id, 0, { textsJson: { title: 'after' } });

    const row = await albumRepo.findById(album.id);
    assert.equal(row?.status, 'EDITING');
  } finally {
    await cleanupUser(user.id);
  }
});
