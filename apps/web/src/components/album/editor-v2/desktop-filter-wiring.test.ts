import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const editor = readFileSync(join(here, 'EditorPort.tsx'), 'utf8');
const bar = readFileSync(join(here, 'FilterBar.tsx'), 'utf8');

test('FilterBar uses the exact manifest and unfiltered thumb previews with cleanup guards', () => {
  assert.match(bar, /LUT_DEFINITIONS\.map/);
  assert.match(bar, /getTierBlob\(photoId,\s*'thumb',\s*null\)/);
  assert.match(bar, /lutEngine\.applyPreview/);
  assert.match(bar, /URL\.revokeObjectURL/);
  assert.match(bar, /generationRef/);
  assert.match(bar, /type="range"/);
  assert.match(bar, /全书/);
  assert.match(bar, /当前照片/);
});

test('desktop controls are support-gated and selected-image action resolves the actual slot photo', () => {
  assert.match(editor, /lutEngine\.isSupported\(\)/);
  assert.match(editor, /lutSupported\s*&&[\s\S]*?openBookFilter/);
  assert.match(editor, /page\.imagesJson\[slotId\]/);
  assert.match(editor, /openPhotoFilter\('photo'/);
});

test('filter persistence is a photoFilter-only 180ms PATCH with stale-response protection', () => {
  assert.match(editor, /setTimeout\([\s\S]*?180\)/);
  assert.match(editor, /JSON\.stringify\(\{\s*photoFilter\s*\}\)/);
  assert.match(editor, /filterPersistGeneration/);
  assert.match(editor, /normalized.*photoFilter|photoFilter.*normalized/);
  assert.doesNotMatch(editor, /JSON\.stringify\(\{\s*photoFilter[\s\S]{0,100}(title|boardBackground)/);
});

test('display reload and every desktop export consume the current filter state', () => {
  assert.match(editor, /getTierUrls\(ids,\s*'display',\s*state\)/);
  assert.match(editor, /displayReloadGeneration/);
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
  assert.match(editor, /collectSnapshotEntries\(bookPhotoIds\(\),\s*currentPhotoFilter\)/);
  assert.match(editor, /filterSnapshotMismatches/);
  assert.match(editor, /getTierBlobStatus\(entry\.photoId,\s*'display',\s*currentPhotoFilter\)/);
  assert.match(editor, /filteredFallback/);
  assert.match(editor, /signPhotoSnapshotUpload\(albumId,\s*pairs\.map\(\(p\) => p\.entry\)\)/);
  assert.match(editor, /confirmPhotoSnapshot\(albumId,\s*uploaded\)/);
  assert.match(editor, /snapshotRenderVersions\[entry\.photoId\]\s*=\s*entry\.renderVersion/);
});
