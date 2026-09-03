import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

const { db } = await import('../../db/client');
const { albumRepo } = await import('../../db/repos/album-repo');
const { cleanupUser, isDbReachable, makeAlbum, makeUser } = await import(
  '../../db/repos/__test__/setup'
);
const { albumService } = await import('./album-service');

test('updating photo filters persists normalized state and invalidates completed derivatives', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const user = await makeUser('photo-filter-flow');

  try {
    const album = await makeAlbum(user.id, { photoCount: 2 });
    await albumRepo.update(db, album.id, {
      status: 'COMPLETED',
      pdfUrl: 'https://cdn.yujee.test/book.pdf',
      pdfR2Key: `pdfs/${user.id}/${album.id}.pdf`,
      coverThumbnailUrl: 'https://cdn.yujee.test/cover.jpg',
      coverThumbnailR2Key: `cover-thumbs/${user.id}/${album.id}.jpg`,
    });

    const result = await albumService.updatePhotoFilter(user.id, album.id, {
      default: { lutId: 'fuji-portrait', strength: 80 },
    }, 0);

    assert.equal(result.photoFilter?.default?.lutId, 'fuji-portrait');
    const row = await albumRepo.findById(album.id);
    assert.equal(row?.status, 'EDITING');
    assert.equal(row?.pdfUrl, null);
    assert.equal(row?.pdfR2Key, null);
    assert.equal(row?.coverThumbnailUrl, null);
    assert.equal(row?.coverThumbnailR2Key, null);

    const detail = await albumService.getDetail(user.id, album.id);
    assert.deepEqual(detail.album.photoFilter, result.photoFilter);
    const list = await albumService.listByUser(user.id);
    assert.deepEqual(list.find((item) => item.id === album.id)?.photoFilter, result.photoFilter);
  } finally {
    await cleanupUser(user.id);
  }
});

test('updatePhotoFilter locks the owned row and preserves a concurrent non-COMPLETED status', async () => {
  const tx = { marker: 'photo-filter-tx' };
  let writtenPatch: Record<string, unknown> | undefined;
  const staleRead = mock.method(albumRepo, 'findById', async () => ({
    id: 'album-atomic',
    userId: 'user-atomic',
    status: 'COMPLETED',
  }) as never);
  const lockedRead = mock.method(
    albumRepo,
    'findByIdForUpdate',
    async (actualTx: unknown, albumId: string) => {
      assert.equal(actualTx, tx);
      assert.equal(albumId, 'album-atomic');
      return {
        id: albumId,
        userId: 'user-atomic',
        status: 'FAILED',
        // 全局创作设置 OCC(Phase 2B):锁内基线,与调用方传的 baseSettingsRevision 比较。
        settingsRevision: 0,
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
    async (actualTx: unknown, albumId: string, patch: Record<string, unknown>) => {
      assert.equal(actualTx, tx);
      assert.equal(albumId, 'album-atomic');
      writtenPatch = patch;
    },
  );

  try {
    const result = await albumService.updatePhotoFilter('user-atomic', 'album-atomic', {
      default: { lutId: 'fuji-portrait', strength: 82 },
    }, 0);

    assert.equal(staleRead.mock.callCount(), 0);
    assert.equal(lockedRead.mock.callCount(), 1);
    assert.equal(result.photoFilter?.default?.strength, 80);
    assert.equal(writtenPatch?.status, undefined);
    assert.equal(writtenPatch?.pdfUrl, null);
    assert.equal(writtenPatch?.pdfR2Key, null);
    assert.equal(writtenPatch?.coverThumbnailUrl, null);
    assert.equal(writtenPatch?.coverThumbnailR2Key, null);
    // 设置写成功推进一次 settingsRevision(0 → 1),并随响应回传新基线。
    assert.equal(result.settingsRevision, 1);
    assert.equal(writtenPatch?.settingsRevision, 1);
  } finally {
    update.mock.restore();
    transaction.mock.restore();
    lockedRead.mock.restore();
    staleRead.mock.restore();
  }
});
