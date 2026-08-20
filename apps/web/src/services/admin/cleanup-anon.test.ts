import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '@/db/client';
import { userRepo } from '@/db/repos/user-repo';
import { albumRepo } from '@/db/repos/album-repo';
import { users } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { cleanupUser, isDbReachable, makeAlbum, makeUser } from '@/db/repos/__test__/setup';
import { adminService } from './admin-service';

// 游客清理 cron:只删「一本书都没做」的空游客。
//
// 做过书的游客**永久保留** —— 他传了照片、等过生成、翻过成品,是转化漏斗上最强的
// 意向信号,也是后台定点优化的唯一样本。删掉等于把已经到手的意向用户连同召回话术
// (「你的书还在,注册就能保存」)一起扔了。清理只负责扫掉纯粹来了没动手的空壳,
// 防有人刷号把库撑爆(每 IP 每小时能开 5 个)。

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

test('cleanupAnonymous: 只删到期且一本书都没做的空游客', async (t: TestContext) => {
  if (!(await isDbReachable())) { t.skip('DATABASE_URL is not reachable'); return; }
  const staleEmpty = await makeAnonAgedUser('stale-empty', 8);   // 到期 + 没书 → 删
  const staleWithBook = await makeAnonAgedUser('stale-book', 8); // 到期 + 有书 → 留
  const freshAnon = await makeAnonAgedUser('fresh', 1);          // 没到期 → 留
  const real = await makeUser('anon-cleanup-real');              // 真实号 → 永不入扫
  try {
    const keptAlbum = await makeAlbum(staleWithBook.id, { title: 'kept' });
    const freshAlbum = await makeAlbum(freshAnon.id, { title: 'alive' });

    const result = await adminService.cleanupAnonymous('test', { olderThanDays: 7 });
    assert.ok(result.deleted >= 1, '至少删掉那个空游客');

    assert.equal(await userRepo.findById(staleEmpty.id), undefined, '到期空游客应被删');

    // 这条是本次改动的要害:做过书的游客不论多老都不许删,连书一起留着。
    assert.ok(await userRepo.findById(staleWithBook.id), '做过书的游客必须存活');
    assert.ok(await albumRepo.findById(keptAlbum.id), '他的书也必须还在');

    assert.ok(await userRepo.findById(freshAnon.id), '未到期匿名号存活');
    assert.ok(await albumRepo.findById(freshAlbum.id));
    assert.ok(await userRepo.findById(real.id), '真实账号永不入扫');
  } finally {
    await cleanupUser(staleWithBook.id);
    await cleanupUser(freshAnon.id);
    await cleanupUser(real.id);
    await cleanupUser(staleEmpty.id).catch(() => undefined);
  }
});
