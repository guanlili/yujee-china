import { test } from 'node:test';
import assert from 'node:assert/strict';

const { COLLAB_ERRORS } = await import('./collaboration-errors');
const { AppError } = await import('@/lib/api/error-codes');

// 协同错误的契约在客户端是硬依赖:客户端只允许依赖 code 与结构化 details,
// message 可本地化。所以测试重点不是文案,而是 ①code/status 稳定
// ②details 通道只带该维度该带的东西(尤其不许夹带页面正文)。

test('每个协同错误都返回 AppError,且 code 与创建名一致', () => {
   const factories = {
    ALBUM_ACCESS_DENIED: () => COLLAB_ERRORS.ALBUM_ACCESS_DENIED(),
    OWNER_REQUIRED: () => COLLAB_ERRORS.OWNER_REQUIRED(),
    EDIT_LINK_NOT_FOUND: () => COLLAB_ERRORS.EDIT_LINK_NOT_FOUND(),
    COLLAB_UNSUPPORTED_ALBUM: () => COLLAB_ERRORS.COLLAB_UNSUPPORTED_ALBUM(),
    PHOTO_BACKUP_REQUIRED: () => COLLAB_ERRORS.PHOTO_BACKUP_REQUIRED(),
    EDIT_CONFLICT: () => COLLAB_ERRORS.EDIT_CONFLICT({ pageIndex: 0, currentVersion: 7, currentPage: { a: 1 } }),
    STRUCTURE_CONFLICT: () => COLLAB_ERRORS.STRUCTURE_CONFLICT({ currentStructureRevision: 3 }),
    SETTINGS_CONFLICT: () => COLLAB_ERRORS.SETTINGS_CONFLICT({ currentSettingsRevision: 5 }),
    REVISION_AHEAD: () => COLLAB_ERRORS.REVISION_AHEAD({ since: 9, currentRevision: 4 }),
    AI_RESULT_STALE: () =>
      COLLAB_ERRORS.AI_RESULT_STALE({ currentStructureRevision: 2, currentSettingsRevision: 6 }),
  };

  for (const [code, make] of Object.entries(factories)) {
    const err = make();
    assert.ok(err instanceof AppError, `${code} 必须构造 AppError`);
    assert.equal(err.code, code, `${code} 的 code 必须与工厂名一致`);
  }
});

test('状态码口径：权限 403 / 链接失效 404 / 状态冲突 409', () => {
  assert.equal(COLLAB_ERRORS.ALBUM_ACCESS_DENIED().status, 403);
  assert.equal(COLLAB_ERRORS.OWNER_REQUIRED().status, 403);
  // 404 而非 403:不向持旧 token 者泄露链接是否曾存在。
  assert.equal(COLLAB_ERRORS.EDIT_LINK_NOT_FOUND().status, 404);
  for (const err of [
    COLLAB_ERRORS.COLLAB_UNSUPPORTED_ALBUM(),
    COLLAB_ERRORS.PHOTO_BACKUP_REQUIRED(),
    COLLAB_ERRORS.EDIT_CONFLICT({ pageIndex: 0, currentVersion: 1, currentPage: null }),
    COLLAB_ERRORS.STRUCTURE_CONFLICT({ currentStructureRevision: 1 }),
    COLLAB_ERRORS.SETTINGS_CONFLICT({ currentSettingsRevision: 1 }),
    COLLAB_ERRORS.REVISION_AHEAD({ since: 2, currentRevision: 1 }),
    COLLAB_ERRORS.AI_RESULT_STALE({ currentStructureRevision: 1, currentSettingsRevision: 1 }),
  ]) {
    assert.equal(err.status, 409, `${err.code} 应是 409 状态冲突`);
  }
});

test('EDIT_CONFLICT 的 details 是页面「查看最新」通道，字段齐全', () => {
  const page = { blocks: [{ id: 'b1', text: 'hello' }] };
  const err = COLLAB_ERRORS.EDIT_CONFLICT({ pageIndex: 2, currentVersion: 11, currentPage: page });
  const details = err.details as { pageIndex: number; currentVersion: number; currentPage: unknown };
  assert.equal(details.pageIndex, 2);
  assert.equal(details.currentVersion, 11);
  assert.deepEqual(details.currentPage, page);
});

test('结构/设置/增量/陈旧 AI 的 details 只带 revision，不夹带页面正文', () => {
  const structure = COLLAB_ERRORS.STRUCTURE_CONFLICT({ currentStructureRevision: 4 });
  assert.deepEqual(Object.keys(structure.details as object), ['currentStructureRevision']);

  const settings = COLLAB_ERRORS.SETTINGS_CONFLICT({ currentSettingsRevision: 8 });
  assert.deepEqual(Object.keys(settings.details as object), ['currentSettingsRevision']);

  const ahead = COLLAB_ERRORS.REVISION_AHEAD({ since: 12, currentRevision: 5 });
  assert.deepEqual(Object.keys(ahead.details as object).sort(), ['currentRevision', 'since']);

  const stale = COLLAB_ERRORS.AI_RESULT_STALE({ currentStructureRevision: 3, currentSettingsRevision: 9 });
  assert.deepEqual(Object.keys(stale.details as object).sort(), [
    'currentSettingsRevision',
    'currentStructureRevision',
  ]);
});

test('无 details 的错误不伪造 details', () => {
  for (const err of [
    COLLAB_ERRORS.ALBUM_ACCESS_DENIED(),
    COLLAB_ERRORS.OWNER_REQUIRED(),
    COLLAB_ERRORS.EDIT_LINK_NOT_FOUND(),
    COLLAB_ERRORS.COLLAB_UNSUPPORTED_ALBUM(),
    COLLAB_ERRORS.PHOTO_BACKUP_REQUIRED(),
  ]) {
    assert.equal(err.details, undefined, `${err.code} 不该带 details`);
  }
});
