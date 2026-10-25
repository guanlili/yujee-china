import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDatabaseSsl } from './client';

test('resolveDatabaseSsl keeps the legacy heuristic when DATABASE_SSL is unset', () => {
  assert.equal(resolveDatabaseSsl('postgresql://y@localhost:5432/db', undefined), undefined);
  assert.equal(resolveDatabaseSsl('postgresql://y@127.0.0.1:5432/db', undefined), undefined);
  assert.equal(resolveDatabaseSsl('postgresql://yujee:yujee@postgres:5432/yujee', undefined), 'require');
});

test('resolveDatabaseSsl lets DATABASE_SSL override the heuristic in both directions', () => {
  // disable:远端也关 TLS(可信内网/单机 compose 的 PG 不挂证书)。
  assert.equal(resolveDatabaseSsl('postgresql://y@postgres:5432/db', 'disable'), false);
  // require:本地也强制 TLS —— 启发式不该把显式配置吞掉。
  assert.equal(resolveDatabaseSsl('postgresql://y@localhost:5432/db', 'require'), 'require');
  assert.equal(resolveDatabaseSsl('postgresql://y@postgres:5432/db', 'prefer'), 'prefer');
  assert.equal(resolveDatabaseSsl('postgresql://y@postgres:5432/db', 'verify-full'), 'verify-full');
});
