import { test } from 'node:test';
import assert from 'node:assert/strict';
import { albumMessageRepo } from './album-message-repo';
import { cleanupUser, isDbReachable, makeAlbum, makeUser } from './__test__/setup';
import { db } from '../client';

test('albumMessageRepo: create + findByAlbum + findRecentByAlbum', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping repo integration test');
    return;
  }
  const user = await makeUser('msg');
  try {
    const album = await makeAlbum(user.id);

    await albumMessageRepo.create(db, {
      albumId: album.id,
      userId: user.id,
      role: 'user',
      content: 'make page 2 brighter',
    });
    await albumMessageRepo.create(db, {
      albumId: album.id,
      userId: user.id,
      role: 'assistant',
      content: 'done',
      layoutPatch: [{ pageIndex: 1, textsJson: { mood: 'bright' } }],
    });

    const all = await albumMessageRepo.findByAlbum(album.id);
    assert.equal(all.length, 2);
    assert.equal(all[0]!.role, 'user');
    assert.equal(all[1]!.role, 'assistant');

    const recent = await albumMessageRepo.findRecentByAlbum(album.id, 1);
    assert.equal(recent.length, 1);
    assert.equal(recent[0]!.role, 'assistant');
  } finally {
    await cleanupUser(user.id);
  }
});
