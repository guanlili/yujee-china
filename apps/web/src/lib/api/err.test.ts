import { test } from 'node:test';
import assert from 'node:assert/strict';
import { err } from './err';
import { fromException } from './from-exception';
import { AppError } from './error-codes';

// AppError/err 的 details 扩展(collab plan §7):无 details 的错误响应必须保持
// 逐字兼容(不能多出 "details" 键);仅显式携带 details 的错误(409 EDIT_CONFLICT)
// 才带这个字段。
test('err: 无 details 的响应 JSON 不含 details 键(逐字节兼容)', async () => {
  const res = err('SOME_CODE', 'some message', 403);
  assert.equal(res.status, 403);
  const body = JSON.parse(await res.text()) as { ok: boolean; error: Record<string, unknown> };
  assert.equal(body.ok, false);
  assert.equal(body.error.code, 'SOME_CODE');
  assert.equal('details' in body.error, false, '无 details 时不得出现 details 键');
});

test('err: 携带 details 时输出结构化 details', async () => {
  const res = err('EDIT_CONFLICT', 'Page changed since it was loaded', 409, {
    pageIndex: 3,
    currentVersion: 19,
    currentPage: { texts: { title: '最新' } },
  });
  assert.equal(res.status, 409);
  const body = JSON.parse(await res.text()) as {
    ok: boolean;
    error: { code: string; details: { pageIndex: number; currentVersion: number } };
  };
  assert.equal(body.error.code, 'EDIT_CONFLICT');
  assert.equal(body.error.details.pageIndex, 3);
  assert.equal(body.error.details.currentVersion, 19);
});

test('fromException: AppError.details 透传到响应', async () => {
  const res = fromException(
    new AppError('EDIT_CONFLICT', 'Page changed since it was loaded', 409, {
      pageIndex: 0,
      currentVersion: 7,
      currentPage: null,
    }),
  );
  const body = JSON.parse(await res.text()) as {
    error: { code: string; details: { currentVersion: number } };
  };
  assert.equal(body.error.details.currentVersion, 7);
});

test('fromException: 无 details 的 AppError 响应保持不含 details 键', async () => {
  const res = fromException(new AppError('ALBUM_NOT_OWNED', 'Album not owned by user', 403));
  const body = JSON.parse(await res.text()) as { error: Record<string, unknown> };
  assert.equal('details' in body.error, false);
});
