import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const editorPort = readFileSync(join(here, 'EditorPort.tsx'), 'utf8');
const css = readFileSync(join(here, 'editor-port.css'), 'utf8');
const client = readFileSync(join(here, '..', '..', '..', 'lib', 'album', 'photo-snapshot-client.ts'), 'utf8');
const albumTypes = readFileSync(join(here, '..', 'types.ts'), 'utf8');

test('album detail types expose per-photo snapshot render versions', () => {
  assert.match(
    albumTypes,
    /photoSnapshotRenderVersions\?:\s*Record<string,\s*string>/,
  );
});

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

test('Save button carries the backup state on itself and reverts to idle', () => {
  assert.match(editorPort, /data-action="backupPhotos"/, 'Save button dispatches backupPhotos');
  assert.match(editorPort, /async function backupPhotos\(\)/, 'backupPhotos orchestration exists');
  assert.match(editorPort, /const actions: Record<string, \(\) => void> = \{[\s\S]*?backupPhotos,/, 'backupPhotos registered in actions map');
  // 状态在按钮本身:默认 idle,setSaveState 更新按钮的 data-backup-state
  assert.match(editorPort, /className="save-btn[^"]*"[\s\S]*?data-action="backupPhotos"/, 'the Save button carries the save-btn class');
  assert.match(editorPort, /data-backup-state="idle"/, 'Save button defaults to idle (icon only)');
  assert.match(editorPort, /function setSaveState\(state: BackupState\)/, 'setSaveState drives the button state');
  assert.match(editorPort, /\$\('\[data-action="backupPhotos"\]'\)/, 'setSaveState targets the Save button, not a separate badge');
  // 成功/失败短暂展示后回到 idle
  assert.match(editorPort, /setTimeout\(\(\) => setSaveState\('idle'\)/, 'backed-up/failed auto-revert to idle');
  // 旧的顶栏静态徽标彻底移除(状态只在按钮上)
  assert.doesNotMatch(editorPort, /className="save-badge/, 'the separate top-left save-badge must be gone');
  assert.doesNotMatch(editorPort, /data-i18n="saved">已保存/, 'the misleading static 已保存 badge must be gone');
  // 按精确渲染版本增量备份,confirm 只登记 PUT 成功的 entry
  assert.match(editorPort, /createFrozenBackupPlan\(\s*bookPhotoIds\(\),\s*currentPhotoFilter,\s*snapshotRenderVersions/, 'backup freezes exact render-version mismatches');
  // 上传档是 'backup'(3400)而不是屏显的 'display'(1600):换设备后导出要拿它当源图,
  // 满页图槽在 scale 3 下要 ~3369px。见 store.ts TIER_MAX_EDGE 注释。
  assert.match(editorPort, /getTierBlobStatus\(entry\.photoId, 'backup', frozenState\)/, 'backup observes filtered fallback status from one frozen state');
  assert.match(editorPort, /correlateSignedSnapshotUploads\(requestedEntries, signed\)/, 'backup correlates signatures by exact entry before PUT');
  assert.match(editorPort, /confirmPhotoSnapshot\(albumId, uploaded\)/, 'confirm registers only successfully uploaded ids');
});

test('Export + Save are icon-only, and the Save hover animation exists', () => {
  // 图标按钮:导出文案隐藏(icon-only),保存默认只图标(文字走 save-label 状态位)
  assert.match(editorPort, /className="hidden" data-i18n="exportPdf"/, 'export button text is hidden (icon only)');
  assert.doesNotMatch(editorPort, /hidden sm:inline" data-i18n="exportPdf"/, 'export button must not show its text label anymore');
  assert.match(editorPort, /className="save-label" data-backup-label/, 'Save label only shows during a backup state');
  // hover 动效(参考翻页按钮的填充 + 轻微上浮)
  // 选择器允许与 share-btn 等分组(逗号)——只锁「save-btn:hover 规则里有上浮」这件事
  assert.match(css, /\.editor-port \.save-btn:hover[,{][\s\S]*?transform: translateY\(-1px\)/, 'Save button lifts on hover');
  assert.match(css, /\.editor-port \.save-btn\[data-backup-state="backed-up"\] \.backup-dot\{ background: var\(--grad-green\)/, 'backed-up shows a green dot');
  assert.match(css, /\.editor-port \.save-btn\[data-backup-state="failed"\] \.backup-dot\{ background: #e5484d/, 'failed shows a red dot');
});

/* §5.4 口径变了:从「本机没原图 → 不给导出」改成「照导 + 如实告知」。
   变的理由:导出取数已经会回落到已备份的服务器图(getPdfDataUrls 的 backupUrls),
   缺图导出来不再必然是空的,那道闸就成了纯挡路 —— 何况移动端从来没实现它,
   两端行为本就不一致。现在两端统一为「能导 + 告知」。
   仍然一张都没有(既无本地原图也没备份)的那几张导出来还是空的,所以照实说。 */
test('本机缺原图时:照导,但导出前如实告知(不再换成「下载 PDF」)', () => {
  assert.match(editorPort, /photoStore\.getBlob\(id\)/, '仍然靠 getBlob 探测本机有没有原图');
  assert.match(editorPort, /exportSourceNotice/, '探测结果要落到一条告知上');
  assert.match(editorPort, /fromBackup/, '要分清「走云端备份图」和「彻底没有」');
  assert.match(editorPort, /missing/);
  assert.match(editorPort, /showExportSourceNotice\(\)/, '导出菜单打开时说一次');
  assert.doesNotMatch(
    editorPort,
    /labelEl\.textContent = aT\('下载 PDF'/,
    '那道闸已经撤掉 —— 留着就又回到「桌面挡着、移动放开」的打架状态',
  );
});

test('photo-snapshot client posts to the sign/confirm routes and PUTs jpeg', () => {
  assert.match(client, /\/api\/v1\/albums\/\$\{albumId\}\/photo-snapshot-upload-url/, 'sign route');
  assert.match(client, /\/api\/v1\/albums\/\$\{albumId\}\/photo-snapshot`/, 'confirm route');
  assert.match(client, /method: 'PUT'[\s\S]*?'content-type': 'image\/jpeg'/, 'PUT uploads jpeg to the signed url');
});
