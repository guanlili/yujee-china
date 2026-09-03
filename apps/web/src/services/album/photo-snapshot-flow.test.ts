import { mock, test } from 'node:test';
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
const V1 = 'pf-v1__original';
const V2 = 'pf-v1__fuji-portrait__80';
const V3 = 'pf-v1__daily-soft__60';

test('photo-snapshot sign: rejects empty / oversized / invalid entries, signs versioned PUTs', async (t) => {
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
      () => albumService.signPhotoSnapshotUpload(user.id, album.id, [
        { photoId: '../evil', renderVersion: V1 },
      ]),
      (err: { code?: string }) => err.code === 'VALIDATION_FAILED',
    );
    await assert.rejects(
      () => albumService.signPhotoSnapshotUpload(user.id, album.id, [
        { photoId: P1, renderVersion: '../evil' },
      ]),
      (err: { code?: string }) => err.code === 'VALIDATION_FAILED',
    );
    await assert.rejects(
      () => albumService.signPhotoSnapshotUpload(user.id, album.id, [
        { photoId: P1, renderVersion: V1 },
        { photoId: P1, renderVersion: V2 },
      ]),
      (err: { code?: string }) => err.code === 'VALIDATION_FAILED',
    );

    const signed = await albumService.signPhotoSnapshotUpload(user.id, album.id, [
      { photoId: P1, renderVersion: V1 },
      { photoId: P2, renderVersion: V2 },
    ]);
    assert.equal(signed.length, 2);
    assert.equal(signed[0]!.photoId, P1);
    assert.equal(signed[0]!.renderVersion, V1);
    assert.equal(
      signed[0]!.r2Key,
      `photo-snapshots/${user.id}/${album.id}/${P1}/${V1}.jpg`,
    );
    assert.ok(signed[0]!.putUrl.startsWith('https://'));
    assert.ok(
      signed[0]!.publicUrl.endsWith(
        `photo-snapshots/${user.id}/${album.id}/${P1}/${V1}.jpg`,
      ),
    );
  } finally {
    await cleanupUser(user.id);
  }
});

test('photo-snapshot confirm: partial merges versions and detail exposes URLs plus versions', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const user = await makeUser('photo-snap-confirm');
  try {
    const album = await makeAlbum(user.id, { photoCount: 3 });

    // detail 起手为空(未备份)
    const before = await albumService.getDetail(user.id, album.id);
    assert.deepEqual(before.album.photoSnapshotUrls, {});
    assert.deepEqual(before.album.photoSnapshotRenderVersions, {});

    await albumService.confirmPhotoSnapshot(user.id, album.id, [
      { photoId: P1, renderVersion: V1 },
      { photoId: P2, renderVersion: V2 },
    ]);
    // 再存一次:更新 P2 的版本 + 新增 P3,不丢 untouched P1。
    const merged = await albumService.confirmPhotoSnapshot(user.id, album.id, [
      { photoId: P2, renderVersion: V3 },
      { photoId: P3, renderVersion: V1 },
    ]);
    assert.deepEqual(new Set(merged.photoIds), new Set([P1, P2, P3]));
    assert.deepEqual(merged.renderVersions, { [P1]: V1, [P2]: V3, [P3]: V1 });

    const row = await albumRepo.findById(album.id);
    assert.deepEqual(new Set(row?.photoSnapshot?.photoIds ?? []), new Set([P1, P2, P3]));
    assert.deepEqual(row?.photoSnapshot?.renderVersions, {
      [P1]: V1,
      [P2]: V3,
      [P3]: V1,
    });
    assert.ok(row?.photoSnapshot?.updatedAt);

    const after = await albumService.getDetail(user.id, album.id);
    assert.ok(
      after.album.photoSnapshotUrls?.[P1]?.endsWith(
        `photo-snapshots/${user.id}/${album.id}/${P1}/${V1}.jpg`,
      ),
    );
    assert.equal(Object.keys(after.album.photoSnapshotUrls ?? {}).length, 3);
    assert.deepEqual(after.album.photoSnapshotRenderVersions, {
      [P1]: V1,
      [P2]: V3,
      [P3]: V1,
    });
  } finally {
    await cleanupUser(user.id);
  }
});

test('photo-snapshot confirm locks before merge and preserves untouched legacy/versioned state', async () => {
  const tx = { marker: 'snapshot-tx' };
  let writtenSnapshot: Record<string, unknown> | undefined;
  const staleRead = mock.method(albumRepo, 'findById', async () => {
    throw new Error('confirm must not merge from a stale read');
  });
  const lockedRead = mock.method(
    albumRepo,
    'findByIdForUpdate',
    async (actualTx: unknown, albumId: string) => {
      assert.equal(actualTx, tx);
      assert.equal(albumId, 'album-atomic');
      return {
        id: albumId,
        userId: 'user-atomic',
        photoSnapshot: {
          photoIds: [P1, P2],
          renderVersions: { [P2]: V2 },
          updatedAt: '2026-07-01T00:00:00.000Z',
        },
      } as never;
    },
  );
  const transaction = mock.method(
    db,
    'transaction',
    (async (fn: (actualTx: unknown) => Promise<unknown>) => fn(tx)) as never,
  );
  const update = mock.method(
    albumRepo,
    'update',
    async (_actualTx: unknown, albumId: string, patch: { photoSnapshot?: Record<string, unknown> }) => {
      assert.equal(albumId, 'album-atomic');
      writtenSnapshot = patch.photoSnapshot;
    },
  );

  try {
    const merged = await albumService.confirmPhotoSnapshot('user-atomic', 'album-atomic', [
      { photoId: P2, renderVersion: V3 },
      { photoId: P3, renderVersion: V1 },
    ]);

    assert.equal(staleRead.mock.callCount(), 0);
    assert.equal(lockedRead.mock.callCount(), 1);
    assert.deepEqual(merged, {
      photoIds: [P1, P2, P3],
      renderVersions: { [P2]: V3, [P3]: V1 },
    });
    assert.deepEqual(writtenSnapshot, {
      photoIds: [P1, P2, P3],
      renderVersions: { [P2]: V3, [P3]: V1 },
      updatedAt: writtenSnapshot?.updatedAt,
    });
    assert.equal(typeof writtenSnapshot?.updatedAt, 'string');
  } finally {
    update.mock.restore();
    transaction.mock.restore();
    lockedRead.mock.restore();
    staleRead.mock.restore();
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

test('photo-snapshot (collab rework §3.3): editor can back up; keys stay in the owner namespace', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const { albumMemberRepo } = await import('../../db/repos/album-member-repo');
  const owner = await makeUser('photo-snap-editor-owner');
  const editor = await makeUser('photo-snap-editor-member');
  const stranger = await makeUser('photo-snap-editor-stranger');
  try {
    const album = await makeAlbum(owner.id, { photoCount: 2 });
    await albumMemberRepo.addMemberIfAbsent(db, album.id, editor.id);

    // editor 备份:签发的 key 归 **owner** 命名空间(读侧 URL 按 owner 派生,
    // editor 执行者不能把字节写进读侧找不到的位置)。
    const signed = await albumService.signPhotoSnapshotUpload(editor.id, album.id, [
      { photoId: P1, renderVersion: V2 },
    ]);
    assert.match(signed[0]!.r2Key, new RegExp(`photo-snapshots/${owner.id}/${album.id}/${P1}/${V2}`));
    assert.doesNotMatch(signed[0]!.r2Key, new RegExp(`/${editor.id}/`));

    // editor confirm:快照台账合并进相册。
    const confirmed = await albumService.confirmPhotoSnapshot(editor.id, album.id, [
      { photoId: P1, renderVersion: V2 },
    ]);
    assert.deepEqual(confirmed.renderVersions, { [P1]: V2 });

    // stranger 拒绝。
    await assert.rejects(
      () => albumService.signPhotoSnapshotUpload(stranger.id, album.id, [
        { photoId: P1, renderVersion: V2 },
      ]),
      (err: { code?: string }) => err.code === 'ALBUM_ACCESS_DENIED',
    );
    await assert.rejects(
      () => albumService.confirmPhotoSnapshot(stranger.id, album.id, [
        { photoId: P1, renderVersion: V2 },
      ]),
      (err: { code?: string }) => err.code === 'ALBUM_ACCESS_DENIED',
    );
  } finally {
    await cleanupUser(owner.id);
    await cleanupUser(editor.id);
    await cleanupUser(stranger.id);
  }
});
