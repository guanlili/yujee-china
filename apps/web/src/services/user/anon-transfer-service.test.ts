import assert from 'node:assert/strict';
import { test } from 'node:test';

import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { userRepo } from '@/db/repos/user-repo';
import { albumRepo } from '@/db/repos/album-repo';
import { albums, agentJobs, albumMessages } from '@/db/schema';
import { cleanupUser, isDbReachable, makeAlbum, makeUser } from '@/db/repos/__test__/setup';
import { anonTransferService } from './anon-transfer-service';

test('anonTransferService.transfer: 相册/任务/消息整体过户,匿名侧清空', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping integration test');
    return;
  }
  const anon = await userRepo.upsertById(db, {
    email: `anon-transfer-${Date.now()}@yujee.test`,
    name: 'Anonymous',
    isAnonymous: true,
    creditBalance: 0,
  });
  const real = await makeUser('anon-transfer-real');
  try {
    const album = await makeAlbum(anon.id, { title: 'Guest Book' });
    await db.insert(agentJobs).values({
      requestId: `anon-transfer-${Date.now()}`,
      albumId: album.id,
      userId: anon.id,
      kind: 'init',
    });
    await db.insert(albumMessages).values({
      albumId: album.id,
      userId: anon.id,
      role: 'user',
      seq: 1,
      content: 'guest message',
    });

    const result = await anonTransferService.transfer(anon.id, real.id);
    assert.equal(result.albums, 1);

    const movedAlbum = await albumRepo.findById(album.id);
    assert.equal(movedAlbum?.userId, real.id);
    const jobs = await db.select().from(agentJobs).where(eq(agentJobs.albumId, album.id));
    assert.equal(jobs[0]?.userId, real.id);
    const messages = await db.select().from(albumMessages).where(eq(albumMessages.albumId, album.id));
    assert.equal(messages[0]?.userId, real.id);

    const leftovers = await db.select().from(albums).where(eq(albums.userId, anon.id));
    assert.equal(leftovers.length, 0);
  } finally {
    await cleanupUser(real.id); // 相册已过户到 real 名下,先清它
    await cleanupUser(anon.id);
  }
});

test('anonTransferService.transfer: 匿名名下无相册时安全返回 0', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping integration test');
    return;
  }
  const anon = await userRepo.upsertById(db, {
    email: `anon-transfer-empty-${Date.now()}@yujee.test`,
    name: 'Anonymous',
    isAnonymous: true,
    creditBalance: 0,
  });
  const real = await makeUser('anon-transfer-empty-real');
  try {
    const result = await anonTransferService.transfer(anon.id, real.id);
    assert.equal(result.albums, 0);
  } finally {
    await cleanupUser(real.id);
    await cleanupUser(anon.id);
  }
});
