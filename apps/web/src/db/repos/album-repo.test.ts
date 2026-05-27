import { test } from 'node:test';
import assert from 'node:assert/strict';
import { albumRepo } from './album-repo';
import { cleanupUser, isDbReachable, makeAlbum, makeUser } from './__test__/setup';
import { db } from '../client';

test('albumRepo: create + findById + findByUser + update', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping repo integration test');
    return;
  }
  const user = await makeUser('album');
  try {
    const album = await makeAlbum(user.id, { title: 'First Album' });
    const fetched = await albumRepo.findById(album.id);
    assert.equal(fetched?.id, album.id);
    assert.equal(fetched?.status, 'AGENT_RUNNING');

    const list = await albumRepo.findByUser(user.id);
    assert.equal(list.length, 1);
    assert.equal(list[0]!.id, album.id);

    await albumRepo.update(db, album.id, { status: 'EDITING', pageCount: 4 });
    const updated = await albumRepo.findById(album.id);
    assert.equal(updated?.status, 'EDITING');
    assert.equal(updated?.pageCount, 4);
  } finally {
    await cleanupUser(user.id);
  }
});
