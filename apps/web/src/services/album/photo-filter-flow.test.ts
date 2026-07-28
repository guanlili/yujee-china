import assert from 'node:assert/strict';
import { test } from 'node:test';

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
    });

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
