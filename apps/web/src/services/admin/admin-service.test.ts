import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { accounts } from '../../db/schema';
import { albumRepo } from '../../db/repos/album-repo';
import { userRepo } from '../../db/repos/user-repo';
import { creditLedgerRepo } from '../../db/repos/credit-ledger-repo';
import { cleanupUser, isDbReachable, makeAlbum, makeUser } from '../../db/repos/__test__/setup';
import { draftPageRepo } from '../../db/repos/draft-page-repo';
import type { Page } from '@yujee/contracts';
import { adminService } from './admin-service';

const DAY = 24 * 60 * 60 * 1000;

test('adminService.listUsers: returns recent users with album counts', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping admin-service integration test');
    return;
  }
  const user = await makeUser('admin-list');
  try {
    await albumRepo.create(db, {
      userId: user.id,
      title: 'A',
      prompt: 'p',
      photoCount: 3,
      status: 'EDITING',
      pageCount: 0,
    });
    await albumRepo.create(db, {
      userId: user.id,
      title: 'B',
      prompt: 'p',
      photoCount: 3,
      status: 'COMPLETED',
      pageCount: 0,
    });

    const { users } = await adminService.listUsers(user.id, { limit: 100 });
    const row = users.find((u) => u.id === user.id);
    assert.ok(row, 'created user should appear in listUsers');
    assert.equal(row?.albumCount, 2);
    assert.equal(row?.email, user.email);
  } finally {
    await cleanupUser(user.id);
  }
});

// 游客账号(better-auth anonymous 插件建的 temp 邮箱行)注册最快、按 createdAt 倒序
// 排在最前,不筛掉就会把真实用户挤出第一页。默认隐藏,后台想看时显式打开。
async function makeAnonUser(suffix: string) {
  return userRepo.upsertById(db, {
    email: `repo-test-anon-${suffix}-${Date.now()}@yujee.test`,
    name: 'Anonymous',
    creditBalance: 0,
    isAnonymous: true,
  });
}

test('adminService.listUsers: hides anonymous guests by default', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping admin-service integration test');
    return;
  }
  const real = await makeUser('admin-anon-default');
  const anon = await makeAnonUser('admin-anon-default');
  try {
    const { users } = await adminService.listUsers(real.id, { limit: 100 });
    const ids = users.map((u) => u.id);
    assert.ok(ids.includes(real.id), 'real user should be listed');
    assert.ok(!ids.includes(anon.id), 'anonymous guest should be hidden by default');
  } finally {
    await cleanupUser(real.id);
    await cleanupUser(anon.id);
  }
});

test('adminService.listUsers: includeAnonymous surfaces guests', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping admin-service integration test');
    return;
  }
  const real = await makeUser('admin-anon-on');
  const anon = await makeAnonUser('admin-anon-on');
  try {
    const { users } = await adminService.listUsers(real.id, {
      limit: 100,
      includeAnonymous: true,
    });
    const ids = users.map((u) => u.id);
    assert.ok(ids.includes(real.id), 'real user should still be listed');
    assert.ok(ids.includes(anon.id), 'anonymous guest should be listed when asked for');
  } finally {
    await cleanupUser(real.id);
    await cleanupUser(anon.id);
  }
});

test('adminService.listUsers: total counts the whole filtered set, not the page', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping admin-service integration test');
    return;
  }
  const a = await makeUser('admin-total-a');
  const b = await makeUser('admin-total-b');
  const c = await makeUser('admin-total-c');
  try {
    const page = await adminService.listUsers(a.id, { limit: 2 });
    assert.equal(page.users.length, 2, 'page should honour limit');
    assert.ok(page.total > 2, 'total should count beyond the page');
  } finally {
    await cleanupUser(a.id);
    await cleanupUser(b.id);
    await cleanupUser(c.id);
  }
});

test('adminService.listUsers: total follows the anonymous filter', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping admin-service integration test');
    return;
  }
  const anon = await makeAnonUser('admin-total-anon');
  try {
    const hidden = await adminService.listUsers(anon.id, { limit: 1 });
    const shown = await adminService.listUsers(anon.id, { limit: 1, includeAnonymous: true });
    assert.ok(
      shown.total > hidden.total,
      'total must shrink when guests are filtered out, or the pager will show empty pages',
    );
  } finally {
    await cleanupUser(anon.id);
  }
});

test('adminService.listUsers: offset moves the window', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping admin-service integration test');
    return;
  }
  const a = await makeUser('admin-offset-a');
  const b = await makeUser('admin-offset-b');
  try {
    // 测试文件并行跑,别的文件插一个用户就会把窗口整体后移,让 offset 1 复读 offset 0
    // 的那行 —— 那是并发,不是缺陷。用 total 判定两次读之间有没有人动过表,动过就重来。
    for (let attempt = 0; ; attempt++) {
      const first = await adminService.listUsers(a.id, { limit: 1, offset: 0 });
      const second = await adminService.listUsers(a.id, { limit: 1, offset: 1 });
      if (first.total !== second.total) {
        assert.ok(attempt < 5, 'table kept changing under the test; giving up');
        continue;
      }
      assert.equal(first.users.length, 1);
      assert.equal(second.users.length, 1);
      assert.notEqual(
        first.users[0]?.id,
        second.users[0]?.id,
        'offset 1 must skip the first row, not repeat it',
      );
      break;
    }
  } finally {
    await cleanupUser(a.id);
    await cleanupUser(b.id);
  }
});

test('adminService.listUsers: an out-of-range page lands on the last page, not an empty one', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping admin-service integration test');
    return;
  }
  const user = await makeUser('admin-overshoot');
  try {
    // 后台收藏了 ?page=9 之后用户变少,或者 URL 被手改成天文数字:都不该翻出空白页,
    // 更不该把 5e+21 这种 offset 送进 SQL。
    const res = await adminService.listUsers(user.id, { limit: 1, offset: 10_000_000 });
    assert.equal(res.users.length, 1, 'should fall back to the last page, not return nothing');
    assert.equal(res.offset, res.total - 1, 'effective offset should be clamped to the last page');
  } finally {
    await cleanupUser(user.id);
  }
});

test('adminService.cleanupAbandoned: deletes only old FAILED albums', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping admin-service integration test');
    return;
  }
  const user = await makeUser('admin-cleanup');
  try {
    const old = new Date(Date.now() - 60 * DAY);
    const failedOld = await albumRepo.create(db, {
      userId: user.id,
      title: 'old failed',
      prompt: 'p',
      photoCount: 3,
      status: 'FAILED',
      pageCount: 0,
      createdAt: old,
    });
    const failedRecent = await albumRepo.create(db, {
      userId: user.id,
      title: 'recent failed',
      prompt: 'p',
      photoCount: 3,
      status: 'FAILED',
      pageCount: 0,
    });
    const editingOld = await albumRepo.create(db, {
      userId: user.id,
      title: 'old editing',
      prompt: 'p',
      photoCount: 3,
      status: 'EDITING',
      pageCount: 0,
      createdAt: old,
    });

    const res = await adminService.cleanupAbandoned(user.id, { olderThanDays: 30 });
    assert.ok(res.deleted >= 1);

    assert.equal(await albumRepo.findById(failedOld.id), undefined, 'old FAILED purged');
    assert.ok(await albumRepo.findById(failedRecent.id), 'recent FAILED kept');
    assert.ok(await albumRepo.findById(editingOld.id), 'non-FAILED kept');
  } finally {
    await cleanupUser(user.id);
  }
});

test('adminService.grantCredit: rejects bad amounts before any DB work', async () => {
  const email = 'nobody@yujee.test';
  await assert.rejects(() => adminService.grantCredit('actor', { email, amount: 0 }), /non-zero/);
  await assert.rejects(() => adminService.grantCredit('actor', { email, amount: 1.5 }), /non-zero/);
  await assert.rejects(
    () => adminService.grantCredit('actor', { email, amount: 100001 }),
    /magnitude/,
  );
});

test('adminService.grantCredit: unknown email throws USER_NOT_FOUND', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping admin-service integration test');
    return;
  }
  await assert.rejects(
    () => adminService.grantCredit('actor', { email: `missing-${Date.now()}@yujee.test`, amount: 10 }),
    /No user with that email/,
  );
});

test('adminService.grantCredit: adds credits, updates balance, writes ADMIN_ADJUST ledger', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping admin-service integration test');
    return;
  }
  const user = await makeUser('admin-grant'); // starts at creditBalance 100
  try {
    // case-insensitive lookup: pass the address upper-cased
    const res = await adminService.grantCredit(user.id, {
      email: user.email.toUpperCase(),
      amount: 50,
      note: 'welcome bonus',
    });
    assert.equal(res.delta, 50);
    assert.equal(res.balanceAfter, 150);
    assert.equal(res.email, user.email);

    const fresh = await userRepo.findById(user.id);
    assert.equal(fresh?.creditBalance, 150);

    const ledger = await creditLedgerRepo.findByUser(user.id, 10);
    const row = ledger.find((r) => r.reason === 'ADMIN_ADJUST');
    assert.ok(row, 'an ADMIN_ADJUST ledger row should exist');
    assert.equal(row?.delta, 50);
    assert.equal(row?.balanceAfter, 150);
    assert.equal((row?.meta as { actorId?: string } | null)?.actorId, user.id);
  } finally {
    await cleanupUser(user.id);
  }
});

test('adminService.grantCredit: negative amount deducts', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping admin-service integration test');
    return;
  }
  const user = await makeUser('admin-deduct'); // starts at 100
  try {
    const res = await adminService.grantCredit(user.id, { email: user.email, amount: -30 });
    assert.equal(res.delta, -30);
    assert.equal(res.balanceAfter, 70);
    const fresh = await userRepo.findById(user.id);
    assert.equal(fresh?.creditBalance, 70);
  } finally {
    await cleanupUser(user.id);
  }
});

test('adminService.getAnalytics: returns full shape with non-negative totals', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping admin-service integration test');
    return;
  }
  const user = await makeUser('admin-analytics');
  try {
    const data = await adminService.getAnalytics(user.id);

    assert.ok(data.users.total >= 1);
    assert.deepEqual(Object.keys(data.albumsByStatus).sort(), [
      'AGENT_RUNNING',
      'COMPLETED',
      'EDITING',
      'FAILED',
    ]);
    assert.deepEqual(Object.keys(data.jobsByStatus).sort(), [
      'COMPLETED',
      'FAILED',
      'QUEUED',
      'RUNNING',
    ]);
    assert.equal(typeof data.credits.purchased30d, 'number');
    assert.equal(typeof data.credits.consumed30d, 'number');
  } finally {
    await cleanupUser(user.id);
  }
});

test('adminService.createUser: creates a verified user with a credential account', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping admin-service integration test');
    return;
  }
  const actor = await makeUser('admin-create-actor');
  const email = `manual-create-${Date.now()}@yujee.test`;
  let createdId: string | undefined;
  try {
    const res = await adminService.createUser(actor.id, {
      email,
      password: 'supersecret',
      name: 'Manual User',
    });
    createdId = res.id;
    assert.equal(res.email, email);

    const user = await userRepo.findByEmailInsensitive(email);
    assert.ok(user, 'created user should be findable');
    assert.equal(user?.emailVerified, true, 'user must be pre-verified so they can log in');

    const acct = await db.select().from(accounts).where(eq(accounts.userId, user!.id));
    assert.equal(acct.length, 1);
    assert.equal(acct[0]?.providerId, 'credential');
    assert.equal(acct[0]?.accountId, user!.id);
    assert.ok(acct[0]?.password && acct[0].password.length > 0, 'password hash must be stored');

    // Case-insensitive duplicate guard.
    await assert.rejects(
      adminService.createUser(actor.id, { email: email.toUpperCase(), password: 'anotherpass' }),
      /already exists/i,
    );

    // Password policy guard.
    await assert.rejects(
      adminService.createUser(actor.id, { email: `short-${Date.now()}@yujee.test`, password: 'short' }),
      /8/,
    );
  } finally {
    if (createdId) await cleanupUser(createdId);
    await cleanupUser(actor.id);
  }
});

// ── repairDraftPages(2026-08-03 线上事故):0024 回填按页对象 pageIndex 字段落行,
// 老相册字段稀疏/重复时行集被打散、重复字段的页被 ON CONFLICT 静默丢弃。修复以
// legacy draftJson.pages 的数组序为真相重建行;envelope-only 相册(行即真相)不动。──
test('repairDraftPages:按 legacy 数组序重建行,字段稀疏/重复的老相册不丢页;envelope-only 相册不动', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping');
    return;
  }
  const user = await makeUser('admin-repair-rows');
  try {
    // 相册甲:老管线形状 —— 字段稀疏且重复(129 出现两次,0024 会丢一页)。
    const legacy = await makeAlbum(user.id);
    const sparsePage = (pageIndex: number, templateId: string, mark: string) => ({
      pageIndex, templateId, images: {}, texts: { title: mark },
    });
    await albumRepo.update(db, legacy.id, {
      status: 'EDITING',
      stage: 'story',
      draftJson: {
        version: 'v3-story',
        tree: { chapters: [] },
        pages: [
          sparsePage(0, 'mag-01', 'COVER'),
          sparsePage(129, 'mag-03', 'A'),
          sparsePage(129, 'mag-05', 'B'),
          sparsePage(132, 'mag-05', 'C'),
        ],
        progress: { currentChapterId: null, doneChapterIds: [] },
      },
    });

    // 相册乙:envelope-only(design-chat 已提交过的形状),行即真相,修复不许碰。
    const envelopeOnly = await makeAlbum(user.id);
    await albumRepo.update(db, envelopeOnly.id, {
      status: 'EDITING',
      stage: 'story',
      draftJson: {
        version: 'v3-story',
        tree: { chapters: [] },
        progress: { currentChapterId: null, doneChapterIds: [] },
      },
    });
    await draftPageRepo.replaceAll(
      db,
      envelopeOnly.id,
      [{ pageIndex: 0, templateId: 'mag-03', images: {}, texts: { title: '行真相' } } as Page],
      7,
      user.id,
    );

    const result = await adminService.repairDraftPages('admin-test');
    assert.ok(result.rows >= 5, '统计返回总行数');

    const rebuilt = await draftPageRepo.findByAlbum(legacy.id);
    assert.deepEqual(
      rebuilt.map((r) => [r.pageIndex, (r.page as Page).pageIndex, ((r.page as Page).texts as Record<string, string>).title]),
      [
        [0, 0, 'COVER'],
        [1, 1, 'A'],
        [2, 2, 'B'],
        [3, 3, 'C'],
      ],
      '按数组序重建:行键与页内字段都归一到位置值,重复字段的页不丢',
    );

    const untouched = await draftPageRepo.findByAlbum(envelopeOnly.id);
    assert.equal(untouched.length, 1);
    assert.equal(((untouched[0]!.page as Page).texts as Record<string, string>).title, '行真相', 'envelope-only 相册的行原样');
    assert.equal(untouched[0]!.version, 7, 'version 不被重写');
  } finally {
    await cleanupUser(user.id);
  }
});
