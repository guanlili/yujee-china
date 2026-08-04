import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { assertRealUser } from './require-auth';

describe('assertRealUser(匿名门禁的纯判定)', () => {
  it('真实账号原样放行,只回 id/email', () => {
    assert.deepEqual(
      assertRealUser({ id: 'u1', email: 'a@b.c', isAnonymous: false }),
      { id: 'u1', email: 'a@b.c' },
    );
  });

  it('匿名账号抛 ANON_UPGRADE_REQUIRED(403)', () => {
    assert.throws(
      () => assertRealUser({ id: 'u2', email: 'temp@x.com', isAnonymous: true }),
      (e: { code?: string; status?: number }) => e.code === 'ANON_UPGRADE_REQUIRED' && e.status === 403,
    );
  });
});
