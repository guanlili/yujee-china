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
      // 给这张一个真滤镜:收敛后「明确不要滤镜」状态下强度行不再挂载(无强度可调)。
      overrides: { selected: { lutId: 'retro-film', strength: 60 } },
    },
    scope: 'photo',
    photoId: 'selected',
    persistError: 'save failed',
    onChange: () => undefined,
    onRetry: () => undefined,
    onClose: () => undefined,
  }));

  assert.match(html, /aria-modal="true"/);
  assert.equal(
    (html.match(/role="dialog"/g) ?? []).length,
    1,
    'ModalHost must be the only dialog when FilterBar is embedded in the sheet',
  );
  assert.match(html, /aria-label="Photo style"/);
  assert.match(html, /mobile-bottom-sheet-overlay/);
  assert.match(html, /mobile-bottom-sheet/);
  assert.match(html, /mobile-sheet-grab/);
  // 这一例没传 onScopeChange = 「更多 → 全书风格」那条入口的形态:只给静态标签。
  // 从选中的照片进来时是**有**切换器的(可以改成整本书),见 filter-pager-and-scope.test.ts。
  assert.match(html, /filter-scope-label/);
  assert.match(html, /This photo/);
  assert.match(html, /filter-card-follow/); // 「跟随全书」从下划线链接变成网格第一张卡
  assert.match(html, /Follow book/);
  assert.match(html, /aria-label="Filter strength"/);
  assert.match(html, /Style failed to save/);
});

test('standalone FilterBar retains dialog semantics', async () => {
  const { FilterBar } = await import('../FilterBar');
  const html = renderToStaticMarkup(createElement(FilterBar, {
    locale: 'en',
    state: null,
    scope: 'book',
    photoId: null,
    persistError: null,
    onChange: () => undefined,
    onRetry: () => undefined,
    onClose: () => undefined,
  }));

  assert.equal((html.match(/role="dialog"/g) ?? []).length, 1);
  assert.match(html, /aria-label="Photo style"/);
});

test('FilterBar can switch photo/book scope and never blocks selection on preview loading', async () => {
  const { FilterBar } = await import('../FilterBar');
  const html = renderToStaticMarkup(createElement(FilterBar, {
    locale: 'en',
    state: { default: null },
    scope: 'photo',
    photoId: 'selected',
    persistError: null,
    onChange: () => undefined,
    onScopeChange: () => undefined,
    onRetry: () => undefined,
    onClose: () => undefined,
  }));

  assert.match(html, /class="filter-scope-switch"/);
  assert.match(html, /class="filter-scope-option"[^>]*aria-pressed="true"[^>]*>This photo/);
  assert.match(html, /class="filter-scope-option"[^>]*aria-pressed="false"[^>]*>Whole book/);
  const filterButtons = html.match(/<button[^>]*class="filter-card"[^>]*>/g) ?? [];
  assert.equal(filterButtons.length, 27);
  for (const button of filterButtons) {
    assert.doesNotMatch(button, /\bdisabled\b/, 'preview loading must not disable direct filter selection');
  }
});

test('mobile root owns normalized filter persistence and registers both filter scopes', () => {
  const root = read('MobileEditorRoot.tsx');
  assert.match(root, /normalizePhotoFilterState\(detail\.album\.photoFilter\)/);
  assert.match(root, /controlledPhotoFilter === undefined \? localPhotoFilter : controlledPhotoFilter/);
  assert.match(root, /controlledSetPhotoFilter \?\? setLocalPhotoFilter/);
  assert.match(root, /createFilterSaveController/);
  // Phase 2B:持久化走共享设置传输层(带 baseSettingsRevision OCC 基线)。
  assert.match(root, /saveAlbumSettings/);
  assert.match(root, /patch:\s*\{\s*photoFilter:\s*state\s*\}/);
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
  // 提交器改成在 effect 内建、cleanup 里 dispose(dispose 已含 invalidate 的 generation++)。
  // 早先是 useMemo([]) + 独立 dispose effect —— 那个形状会被 StrictMode 的模拟卸载
  // 永久废掉,整本书没有图。见 mobile-image-urls.test.ts。
  assert.match(root, /const display = createLatestCommit/);
  assert.match(root, /display\.dispose\(\);/);
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
  // Phase 0 迭代:入口条件是「支持 LUT 且容器给了 handler」(handler 变 optional,
  // 治理口径的隐藏移到容器层)。
  assert.match(more, /\{lutSupported && onPhotoFilter && \(/);
  assert.match(editor, /lutSupported=\{lutSupported\}/);
  assert.match(editView, /\{lutSupported && selectedPhotoId && \(/);
  assert.match(editView, /onPhotoFilter/);
});

test('selected-photo toolbar keeps all four actions reachable on narrow viewports', () => {
  const css = read('mobile-editor.css');
  const editView = read('EditView.tsx');
  const toolbarRule = css.match(/\.mobile-editor \.mimg-bar\s*\{([\s\S]*?)\}/)?.[1] ?? '';
  const buttonRule = css.match(/\.mobile-editor \.mimg-btn\s*\{([\s\S]*?)\}/)?.[1] ?? '';

  assert.match(toolbarRule, /box-sizing:\s*border-box/);
  assert.match(toolbarRule, /width:\s*max-content/);
  assert.match(toolbarRule, /max-width:\s*calc\(100% - 16px\)/);
  assert.match(toolbarRule, /height:\s*40px/);
  assert.match(toolbarRule, /overflow-x:\s*auto/);
  assert.match(toolbarRule, /touch-action:\s*pan-x/);
  assert.match(toolbarRule, /scrollbar-width:\s*none/);
  assert.match(css, /\.mobile-editor \.mimg-bar::-webkit-scrollbar\s*\{[^}]*display:\s*none/);
  assert.match(buttonRule, /flex:\s*0 0 auto/);
  assert.equal(
    (editView.match(/className="mimg-btn"/g) ?? []).length,
    4,
    'replace, reset, filter, and delete actions must remain in the scrollable toolbar',
  );
});

test('mobile export build input passes the current filter to every export format', () => {
  const hook = read('use-export.ts');
  assert.match(hook, /photoFilter:\s*PhotoFilterState \| null/);
  // 第四个参数是服务器备份回落(本地没原图时用它),见 lib/photo/export-backup-fallback.test.ts。
  assert.match(
    hook,
    /getPdfDataUrls\(\s*ids,\s*RASTER_PDF_IMAGE_MAX_EDGE,\s*photoFilter,\s*snapshotUrls,?\s*\)/,
  );
  assert.match(hook, /\[pages,\s*photoFilter,\s*snapshotUrls\]/);
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
