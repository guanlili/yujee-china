import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import * as React from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as { React?: typeof React }).React = React;

const here = dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(join(here, file), 'utf8');

test('FilterSheet registers through ModalHost with accessible shared FilterBar controls', async () => {
  const path = join(here, 'modals', 'FilterSheet.tsx');
  assert.ok(existsSync(path), 'mobile FilterSheet must exist');
  const { FilterSheet } = await import('./modals/FilterSheet');
  const html = renderToStaticMarkup(createElement(FilterSheet, {
    open: true,
    locale: 'en',
    state: {
      default: { lutId: 'cloudy-cool', strength: 80 },
      overrides: { selected: null },
    },
    scope: 'photo',
    photoId: 'selected',
    persistError: 'save failed',
    onChange: () => undefined,
    onRetry: () => undefined,
    onClose: () => undefined,
  }));

  assert.match(html, /aria-modal="true"/);
  assert.match(html, /aria-label="Photo style"/);
  assert.match(html, /Current photo/);
  assert.match(html, /Follow book style/);
  assert.match(html, /aria-label="Filter strength"/);
  assert.match(html, /Style failed to save/);
});

test('mobile root owns normalized filter persistence and registers both filter scopes', () => {
  const root = read('MobileEditorRoot.tsx');
  assert.match(root, /normalizePhotoFilterState\(detail\.album\.photoFilter\)/);
  assert.match(root, /createFilterSaveController/);
  assert.match(root, /JSON\.stringify\(\{\s*photoFilter:\s*state\s*\}\)/);
  assert.match(root, /filterSaver\.schedule\(photoFilter\)/);
  assert.match(root, /filterSaver\.retry\(\)/);
  assert.match(root, /filterSaver\.dispose\(\)/);
  assert.match(root, /<FilterSheet/);
  assert.match(root, /setFilterScope\('book'\)/);
  assert.match(root, /setFilterScope\('photo'\)/);
  assert.match(
    root,
    /pages\[editPage\]\?\.imagesJson\[selection\.slotId\]/,
    'photo scope must target the selected slot’s current actual photo',
  );
});

test('display and thumb loads carry filter state and use latest-only commits without revoking store URLs', () => {
  const root = read('MobileEditorRoot.tsx');
  assert.match(root, /createLatestCommit/);
  assert.match(root, /getTierUrls\(photoIds,\s*'display',\s*photoFilter\)/);
  assert.match(root, /getTierUrls\(photoIds,\s*'thumb',\s*photoFilter\)/);
  assert.match(root, /\[photoIds,\s*photoFilter/);
  assert.match(root, /\.invalidate\(\)/);
  assert.doesNotMatch(
    root,
    /revokeObjectURL\([^)]*(imageUrls|thumbUrls)/,
    'photoStore owns tier URLs; the mobile editor must not revoke them',
  );
  assert.match(root, /photoFilter=\{photoFilter\}/);
  assert.match(root, /selectedPhotoId=\{selectedPhotoId\}/);
});

test('filter entry points are hidden when LUT rendering is unsupported', () => {
  const root = read('MobileEditorRoot.tsx');
  const more = read('modals/MoreSheet.tsx');
  const editor = read('MobileEditor.tsx');
  const editView = read('EditView.tsx');

  assert.match(root, /lutEngine\.isSupported\(\)/);
  assert.match(root, /lutSupported=\{lutSupported\}/);
  assert.match(root, /\{lutSupported && filterOpen && \(/);
  assert.match(more, /\{lutSupported && \(/);
  assert.match(editor, /lutSupported=\{lutSupported\}/);
  assert.match(editView, /\{lutSupported && selectedPhotoId && \(/);
  assert.match(editView, /onPhotoFilter/);
});

test('mobile export build input passes the current filter to every export format', () => {
  const hook = read('use-export.ts');
  assert.match(hook, /photoFilter:\s*PhotoFilterState \| null/);
  assert.match(
    hook,
    /getPdfDataUrls\(\s*ids,\s*RASTER_PDF_IMAGE_MAX_EDGE,\s*photoFilter,?\s*\)/,
  );
  assert.match(hook, /\[pages,\s*photoFilter\]/);
  for (const name of [
    'exportCollage',
    'exportSinglePages',
    'exportLive',
    'exportNineGrid',
    'exportPdf',
  ]) {
    assert.match(hook, new RegExp(`const ${name}`));
  }
  assert.match(hook, /runImageExport[\s\S]*await buildInput\(\)/);
  assert.match(hook, /exportPdf[\s\S]*await buildInput\(\)/);
});
