import assert from 'node:assert/strict';
import { test } from 'node:test';

const module = await import('./share-error').catch(() => null);

// The helper now takes the editor's bound zh/en picker instead of a boolean; these
// two stand in for a zh and an en mount.
const zhAT = (zh: string) => zh;
const enAT = (_zh: string, en: string) => en;

test('share snapshot error mapping is code-driven, localized, and rejects generic/malformed errors', () => {
  assert.ok(module, 'share-error helper must exist');
  const hint = module.photoSnapshotVersionMissingHint;

  assert.equal(
    hint({ code: 'PHOTO_SNAPSHOT_VERSION_MISSING', message: '2' }, zhAT),
    '还有 2 张照片需要按当前风格重新备份',
  );
  assert.equal(
    hint({ code: 'PHOTO_SNAPSHOT_VERSION_MISSING', message: '1' }, enAT),
    '1 photo still needs to be backed up using the current style',
  );
  assert.equal(
    hint({ code: 'PHOTO_SNAPSHOT_VERSION_MISSING', message: '2' }, enAT),
    '2 photos still need to be backed up using the current style',
  );
  assert.equal(hint({ code: 'VALIDATION_FAILED', message: '2' }, zhAT), null);
  assert.equal(
    hint({ code: 'PHOTO_SNAPSHOT_VERSION_MISSING', message: `1 ${'photo-id-secret'}` }, zhAT),
    null,
  );
  assert.equal(hint({ code: 'PHOTO_SNAPSHOT_VERSION_MISSING', message: '0' }, zhAT), null);
});
