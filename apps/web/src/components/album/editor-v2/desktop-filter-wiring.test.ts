import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const editor = readFileSync(join(here, 'EditorPort.tsx'), 'utf8');
const bar = readFileSync(join(here, 'FilterBar.tsx'), 'utf8');
const css = readFileSync(join(here, 'editor-port.css'), 'utf8');

test('FilterBar uses the exact manifest and unfiltered thumb previews with cleanup guards', () => {
  assert.match(bar, /LUT_DEFINITIONS\.map/);
  assert.match(bar, /getTierBlob\(id,\s*'thumb',\s*null\)/);
  assert.match(bar, /lutEngine\.applyPreview/);
  assert.match(bar, /runFilterPreviewGeneration/);
  assert.match(bar, /URL\.revokeObjectURL/);
  assert.match(bar, /generationRef/);
  assert.match(bar, /type="range"/);
  assert.match(bar, /整本书/);
  assert.match(bar, /这张照片/); // 收敛后的文案(原「当前照片」),见 filter-panel-redesign.test.ts
  assert.match(bar, /onScopeChange\?:\s*\(scope:\s*FilterScope\)\s*=>\s*void/);
  assert.doesNotMatch(bar, /disabled=\{previewState !== 'ready'\}/);
});

test('desktop filter panel and cards use the shared editor radius tokens', () => {
  const panelRule = css.match(/\.editor-port \.filter-bar\s*\{([\s\S]*?)\}/)?.[1] ?? '';
  const cardRule = css.match(/\.editor-port \.filter-card\s*\{([\s\S]*?)\}/)?.[1] ?? '';
  assert.match(panelRule, /border-radius:\s*var\(--radius-lg\)/);
  assert.match(cardRule, /border-radius:\s*var\(--radius-md\)/);
  assert.match(css, /\.editor-port \.filter-scope-switch\s*\{/);
});

test('desktop controls are support-gated and selected-image action resolves the actual slot photo', () => {
  assert.match(editor, /lutEngine\.isSupported\(\)/);
  assert.match(editor, /if \(lutSupported\) ov\.appendChild\(style\)/);
  assert.match(editor, /page\.imagesJson\[slotId\]/);
  assert.match(editor, /openPhotoFilter\('photo'/);
});

test('desktop Style lives in selected-image resources, not the global top bar', () => {
  const topbarStart = editor.indexOf('function EditorTopbar(');
  const topbarEnd = editor.indexOf('\nfunction EditorModals(', topbarStart);
  assert.ok(topbarStart >= 0 && topbarEnd > topbarStart);
  const topbar = editor.slice(topbarStart, topbarEnd);
  assert.doesNotMatch(topbar, /openBookFilter/);
  assert.doesNotMatch(topbar, /filter-topbar-btn/);

  assert.match(editor, /style\.className = 'img-edit-style'/);
  assert.match(editor, /<FilterBar[\s\S]*?onScopeChange=\{setFilterScope\}/);
  assert.doesNotMatch(editor, /const openBookFilter = useCallback/);

  const imageButtonRule = css.match(
    /\.editor-port \.img-edit-reset,[\s\S]*?\{([\s\S]*?)\}/,
  )?.[0] ?? '';
  assert.match(imageButtonRule, /\.editor-port \.img-edit-style/);
});

test('filter persistence is a photoFilter-only 180ms PATCH with stale-response protection', () => {
  assert.match(editor, /createFilterSaveController/);
  assert.match(editor, /JSON\.stringify\(\{\s*photoFilter:\s*state\s*\}\)/);
  assert.match(editor, /filterSaver\.schedule\(photoFilter\)/);
  assert.match(editor, /filterSaver\.dispose\(\)/);
  assert.match(editor, /onSuccess:\s*\(normalized\)[\s\S]*?setPhotoFilter/);
  assert.doesNotMatch(editor, /JSON\.stringify\(\{\s*photoFilter[\s\S]{0,100}(title|boardBackground)/);
});

test('display reload and every desktop export consume the current filter state', () => {
  assert.match(editor, /getTierUrls\(ids,\s*'display',\s*state\)/);
  assert.match(editor, /createLatestCommit/);
  assert.match(editor, /displayReload\.dispose\(\)/);
  assert.match(
    editor,
    /getPdfDataUrls\(\s*ids,\s*RASTER_PDF_IMAGE_MAX_EDGE,\s*currentPhotoFilter/,
  );
  for (const path of ['exportSinglePages', 'exportCollage', 'exportLive', 'exportNineGrid', 'renderPdfOnce']) {
    const start = editor.indexOf(`function ${path}`);
    assert.ok(start >= 0, `${path} exists`);
    assert.match(editor.slice(start, start + 1800), /buildExportInput\(/, `${path} uses shared filtered input`);
  }
});

test('desktop backup signs and confirms exact mismatch SnapshotEntry arrays only', () => {
  assert.match(editor, /createFrozenBackupPlan\(\s*bookPhotoIds\(\),\s*currentPhotoFilter/);
  assert.match(editor, /prepareSnapshotBlobs\(/);
  // 上传档 'backup'(3400) 而非屏显 'display'(1600),见 store.ts TIER_MAX_EDGE。
  assert.match(editor, /getTierBlobStatus\(entry\.photoId,\s*'backup',\s*frozenState\)/);
  assert.match(editor, /correlateSignedSnapshotUploads\(requestedEntries,\s*signed\)/);
  assert.match(editor, /uploadCorrelatedSnapshots\(/);
  assert.match(editor, /signPhotoSnapshotUpload\(albumId,\s*requestedEntries\)/);
  assert.match(editor, /confirmPhotoSnapshot\(albumId,\s*uploaded\)/);
  assert.match(editor, /snapshotRenderVersions\[entry\.photoId\]\s*=\s*entry\.renderVersion/);
});
