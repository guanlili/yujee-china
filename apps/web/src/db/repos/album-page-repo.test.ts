import { test } from 'node:test';
import assert from 'node:assert/strict';
import { albumPageRepo } from './album-page-repo';
import { cleanupUser, isDbReachable, makeAlbum, makeUser } from './__test__/setup';
import { db } from '../client';

test('albumPageRepo: bulkInsert + findByAlbum + updateOne', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping repo integration test');
    return;
  }
  const user = await makeUser('album-page');
  try {
    const album = await makeAlbum(user.id);

    await albumPageRepo.bulkInsert(db, [
      {
        albumId: album.id,
        pageIndex: 0,
        templateId: 'mag-01',
        imagesJson: { slot1: 'p1' },
        textsJson: { title: 'Page 1' },
      },
      {
        albumId: album.id,
        pageIndex: 1,
        templateId: 'mag-02',
        imagesJson: { slot1: 'p2' },
        textsJson: { title: 'Page 2' },
      },
    ]);

    const pages = await albumPageRepo.findByAlbum(album.id);
    assert.equal(pages.length, 2);
    assert.equal(pages[0]!.pageIndex, 0);
    assert.equal(pages[1]!.templateId, 'mag-02');

    await albumPageRepo.updateOne(db, album.id, 0, { textsJson: { title: 'Renamed' } });
    const after = await albumPageRepo.findByAlbum(album.id);
    assert.deepEqual(after[0]!.textsJson, { title: 'Renamed' });
  } finally {
    await cleanupUser(user.id);
  }
});
