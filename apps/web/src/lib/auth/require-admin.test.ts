import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowlistedAdminEmail } from './require-admin';

test('isAllowlistedAdminEmail: matches trimmed, case-insensitively', () => {
  const list = 'Admin@Yujee.com, ops@yujee.com';
  assert.equal(isAllowlistedAdminEmail('admin@yujee.com', list), true);
  assert.equal(isAllowlistedAdminEmail('  ADMIN@YUJEE.COM ', list), true);
  assert.equal(isAllowlistedAdminEmail('ops@yujee.com', list), true);
});

test('isAllowlistedAdminEmail: rejects non-members and empties', () => {
  const list = 'admin@yujee.com';
  assert.equal(isAllowlistedAdminEmail('someone@else.com', list), false);
  assert.equal(isAllowlistedAdminEmail('', list), false);
  assert.equal(isAllowlistedAdminEmail(null, list), false);
  assert.equal(isAllowlistedAdminEmail(undefined, list), false);
});

test('isAllowlistedAdminEmail: empty/absent allowlist grants no one', () => {
  assert.equal(isAllowlistedAdminEmail('admin@yujee.com', ''), false);
  assert.equal(isAllowlistedAdminEmail('admin@yujee.com', undefined), false);
  assert.equal(isAllowlistedAdminEmail('admin@yujee.com', '  ,  , '), false);
});
