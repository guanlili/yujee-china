import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const editorPort = readFileSync(join(here, 'EditorPort.tsx'), 'utf8');
const client = readFileSync(join(here, '..', '..', '..', 'lib', 'album', 'photo-snapshot-client.ts'), 'utf8');

test('resolveImage falls back to server snapshot when local is missing', () => {
  // 本地优先,本地没有用服务器压缩图,都没有则空槽(photo-snapshot §5.3)。
  assert.match(
    editorPort,
    /const snapshotUrls[^\n]*=\s*detail\.album\.photoSnapshotUrls\s*\?\?\s*\{\}/,
    'snapshotUrls should come from detail.album.photoSnapshotUrls',
  );
  assert.match(
    editorPort,
    /resolveImage:\s*ResolveImage\s*=\s*\(id\)\s*=>\s*imageUrls\[id\]\s*\?\?\s*snapshotUrls\[id\]/,
    'resolveImage should prefer local, fall back to snapshot',
  );
});

test('Save button + backup badge are wired to backupPhotos', () => {
  assert.match(editorPort, /data-action="backupPhotos"/, 'Save button dispatches backupPhotos');
  assert.match(editorPort, /async function backupPhotos\(\)/, 'backupPhotos orchestration exists');
  // 注册进 data-action 分发表
  assert.match(editorPort, /const actions: Record<string, \(\) => void> = \{[\s\S]*?backupPhotos,/, 'backupPhotos registered in actions map');
  // 徽标语义:诚实的「是否已备份」,不再是会误导的静态「已保存」
  assert.match(editorPort, /data-backup-state="local-only"/, 'badge defaults to local-only (honest unsaved state)');
  assert.match(editorPort, /className="backup-dot/, 'badge has a backup-dot');
  assert.doesNotMatch(editorPort, /data-i18n="saved">已保存/, 'the misleading static 已保存 badge must be gone');
  // 只备份尚未备份的(增量),confirm 只登记 PUT 成功的
  assert.match(editorPort, /bookPhotoIds\(\)\.filter\(\(id\) => !backedUpIds\.has\(id\)\)/, 'backup only uploads not-yet-backed photoIds');
  assert.match(editorPort, /confirmPhotoSnapshot\(albumId, uploaded\)/, 'confirm registers only successfully uploaded ids');
});

test('read-only posture swaps Export for Download PDF when local originals are missing', () => {
  assert.match(editorPort, /photoStore\.getBlob\(id\)/, 'detects missing local originals via getBlob');
  assert.match(editorPort, /Download PDF'\)/, 'export button becomes Download PDF when originals missing');
  assert.match(editorPort, /stopImmediatePropagation\(\)/, 'download override blocks the exportPdf handler');
  assert.match(editorPort, /window\.open\(pdfUrl/, 'download opens the already-exported pdfUrl');
});

test('photo-snapshot client posts to the sign/confirm routes and PUTs jpeg', () => {
  assert.match(client, /\/api\/v1\/albums\/\$\{albumId\}\/photo-snapshot-upload-url/, 'sign route');
  assert.match(client, /\/api\/v1\/albums\/\$\{albumId\}\/photo-snapshot`/, 'confirm route');
  assert.match(client, /method: 'PUT'[\s\S]*?'content-type': 'image\/jpeg'/, 'PUT uploads jpeg to the signed url');
});
