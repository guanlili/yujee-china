import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cleanupUser, isDbReachable, makeUser } from '../../db/repos/__test__/setup';
import { userService } from './user-service';

/* getMe 是前端「我的」页的唯一数据源:
   - 未知用户 401(不是空对象,前端据此踢回登录)。
   - isAnonymous 必须忠实透出 —— 游客账号靠它把菜单换成「登录」CTA;
     错一位就让游客以为自己有正式账号。 */

test('getMe: 字段形状完整,游客标记透出', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping integration test');
    return;
  }
  const user = await makeUser('user-me');
  try {
    const me = await userService.getMe(user.id);
    assert.equal(me.id, user.id);
    assert.equal(me.email, user.email);
    assert.equal(me.creditBalance, 100, '余额按账面原样透出');
    assert.equal(me.isAdmin, false);
    assert.equal(me.isAnonymous, false, '正式用户不能被打成游客');
    assert.ok(me.createdAt instanceof Date);
    for (const key of ['passwordHash', 'emailVerified'] as const) {
      assert.equal(key in me, false, `${key} 这类内部字段不许外泄`);
    }
  } finally {
    await cleanupUser(user.id);
  }
});

test('getMe: 未知用户 401', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping integration test');
    return;
  }
  await assert.rejects(
    userService.getMe('00000000-0000-0000-0000-000000000000'),
    (e: unknown) => (e as { code?: string }).code === 'UNAUTHORIZED',
  );
});
