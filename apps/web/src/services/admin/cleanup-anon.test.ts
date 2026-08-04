import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '@/db/client';
import { userRepo } from '@/db/repos/user-repo';
import { albumRepo } from '@/db/repos/album-repo';
import { users } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { cleanupUser, isDbReachable, makeAlbum, makeUser } from '@/db/repos/__test__/setup';
import { adminService } from './admin-service';

// 游客清理 cron:超过 N 天未转正的匿名账号连同名下相册被级联删掉;
// 新匿名账号与真实账号不受影响。

async function makeAnonAgedUser(suffix: string, ageDays: number) {
  const user = await userRepo.upsertById(db, {
    email: `anon-cleanup-${suffix}-${Date.now()}@yujee.test`,
    name: 'Anonymous',
    isAnonymous: true,
    creditBalance: 0,
  });
  await db
    .update(users)
    .set({ createdAt: new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000) })
    .where(eq(users.id, user.id));
  return user;
}

test('cleanupAnonymous: 8 天前的匿名号连相册级联删;新匿名号与真实号存活', async (t: TestContext) => {
  if (!(await isDbReachable())) { t.skip('DATABASE_URL is not reachable'); return; }
  const staleAnon = await makeAnonAgedUser('stale', 8);
  const freshAnon = await makeAnonAgedUser('fresh', 1);
  const real = await makeUser('anon-cleanup-real');
  try {
    const staleAlbum = await makeAlbum(staleAnon.id, { title: 'doomed' });
    const freshAlbum = await makeAlbum(freshAnon.id, { title: 'alive' });

    const result = await adminService.cleanupAnonymous('test', { olderThanDays: 7 });
    assert.ok(result.deleted >= 1, '至少删掉 stale 匿名号');

    assert.equal(await userRepo.findById(staleAnon.id), undefined);
    assert.equal(await albumRepo.findById(staleAlbum.id), undefined); // cascade

    assert.ok(await userRepo.findById(freshAnon.id), '未到期匿名号存活');
    assert.ok(await albumRepo.findById(freshAlbum.id));
    assert.ok(await userRepo.findById(real.id), '真实账号永不入扫');
  } finally {
    await cleanupUser(freshAnon.id);
    await cleanupUser(real.id);
    // staleAnon 已被清理;防御性兜底(幂等)
    await cleanupUser(staleAnon.id).catch(() => undefined);
  }
});
