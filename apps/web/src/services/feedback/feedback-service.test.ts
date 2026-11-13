import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';

import { db } from '../../db/client';
import { feedback } from '../../db/schema';
import { cleanupUser, isDbReachable, makeUser } from '../../db/repos/__test__/setup';
import { feedbackService } from './feedback-service';

/* 反馈提交的两条守则:
   1. 先落库(真相),再发信(通知);发信失败不许影响提交结果。
   2. 每用户每小时 5 条上限 —— 否则这个端点就是一条匿名灌运营邮件的通道。 */

test('submit: 落库存真、page 可空可填、发信失败不影响提交', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping integration test');
    return;
  }
  const user = await makeUser('feedback-ok');
  try {
    const who = { id: user.id, email: user.email, name: user.name };
    await feedbackService.submit(who, { message: '第一页按钮点不动', page: '/zh/compose' });
    await feedbackService.submit(who, { message: '没有 page 也能提' });

    const rows = await db.select().from(feedback).where(eq(feedback.userId, user.id));
    assert.equal(rows.length, 2);
    assert.equal(rows.find((r) => r.message === '第一页按钮点不动')?.page, '/zh/compose');
    assert.equal(rows.find((r) => r.message === '没有 page 也能提')?.page, null);
    // 测试环境无 SMTP:sendEmail 失败被 service 吞掉,submit 仍正常返回 ——
    // 走到这里不抛错本身就证明「发信失败不影响提交」。
  } finally {
    await cleanupUser(user.id);
  }
});

test('submit: 每小时第 6 条被 429(RATE_LIMITED)', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping integration test');
    return;
  }
  const user = await makeUser('feedback-limit');
  try {
    const who = { id: user.id, email: user.email, name: user.name };
    for (let i = 1; i <= 5; i++) {
      await feedbackService.submit(who, { message: `第 ${i} 条` });
    }
    await assert.rejects(
      feedbackService.submit(who, { message: '第 6 条' }),
      (e: unknown) => (e as { code?: string }).code === 'RATE_LIMITED',
    );

    const rows = await db.select().from(feedback).where(eq(feedback.userId, user.id));
    assert.equal(rows.length, 5, '被限频的那条不落库');
  } finally {
    await cleanupUser(user.id);
  }
});
