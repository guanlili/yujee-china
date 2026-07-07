import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const editorPort = readFileSync(join(here, 'EditorPort.tsx'), 'utf8');
const chatPanel = readFileSync(join(here, 'ChatPanel.tsx'), 'utf8');
const coordinator = readFileSync(join(here, 'editor-coordinator.ts'), 'utf8');
const css = readFileSync(join(here, 'editor-port.css'), 'utf8');
const src = `${editorPort}\n\n${chatPanel}`;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('editor shell uses the supplied unified top chrome and canvas hints', () => {
  assert.match(src, /className="page-glow"/, 'editor should render the shared top glow');
  assert.match(src, /className="topbar nav-shell sticky top-0 z-50 h-14/, 'topbar should use the refreshed translucent nav shell');
  assert.match(src, /height: 'calc\(100vh - 56px\)'/, 'workspace height should match the 56px refreshed topbar');
  assert.match(src, /className="avatar-ring"/, 'user avatar should use the gradient avatar ring');
  assert.match(editorPort, /className="canvas-hint"/, 'canvas should expose the drag/zoom/edit hint from the design');
  assert.match(editorPort, /let panX = 0;\s*let panY = 0;/, 'canvas should keep whole-board pan state');
  assert.match(editorPort, /translate\(\$\{panX\}px, \$\{panY\}px\) scale\(\$\{zoom\}\)/, 'book transform should combine pan and zoom');
  assert.match(editorPort, /stage\?\.addEventListener\('pointerdown', onCanvasPointerDown\)/, 'free canvas should wire pointer drag panning');
  assert.match(editorPort, /className="el-bar"/, 'selected elements should expose the floating edit toolbar');
  assert.match(editorPort, /data-edit-action="reset-photo"/, 'photo toolbar should include a real reset action');
});

test('editor chat rail uses the refreshed draggable card and collapsed jellyfish tab', () => {
  assert.match(editorPort, /className="chat-fold-expand"/, 'collapsed chat tab should no longer be the old slim arrow button');
  assert.match(editorPort, /className="fab-jelly"/, 'collapsed chat tab should carry the floating jellyfish');
  assert.match(chatPanel, /id="chatDrag"/, 'desktop chat should include a drag handle');
  assert.match(chatPanel, /className="chat-mobile-handle/, 'mobile chat should include the bottom-sheet handle');
  assert.match(chatPanel, /className="chat-resize"/, 'desktop chat should include the resize handle');
  assert.match(chatPanel, /function bindChatMotion\(\)/, 'drag and resize handles should be wired to deterministic client-side motion');
  assert.match(chatPanel, /dragHandle(?:El)?\.addEventListener\('pointerdown'/, 'desktop drag handle should listen for pointer drag');
  assert.match(chatPanel, /resizeHandle(?:El)?\.addEventListener\('pointerdown'/, 'desktop resize handle should listen for pointer resize');
  assert.match(chatPanel, /className="composer-group/, 'composer and purchase banner should be grouped for the overlap treatment');
  assert.match(chatPanel, /className="buy-banner"/, 'purchase prompt should use the refreshed banner instead of the old card');
  assert.match(chatPanel, /data-demo-chat/, 'editing mode should keep deterministic mock messages when no real history exists');
  assert.match(chatPanel, /function mockEditChatResponse\(/, 'authoring edit-chat should have a deterministic local mock fallback');
  assert.match(chatPanel, /function shouldUseMockEditFallback\(/, 'mock fallback should be gated so auth and credit errors keep their real behavior');
  assert.match(chatPanel, /appendMockToolReceipt\(/, 'mock fallback should still expose an AI tool-call receipt state');
  assert.match(chatPanel, /thinking-block collapsible/, 'mock AI thoughts should be expandable intermediate states');
  assert.match(chatPanel, /className="op-card"/, 'mock AI tool-call receipts should be rendered');
  assert.match(chatPanel, /className="ai-doc"/, 'mock AI summary should render as document-style markdown');
});

test('editor motion and toolbar controls are functional, not empty chrome', () => {
  assert.match(chatPanel, /function resetForViewport\(\) \{\s*if \(!desktop\(\)\) resetChatPos\(\);/s, 'desktop drag inline styles should clear when resizing to mobile');
  assert.match(chatPanel, /window\.addEventListener\('resize', resetForViewport\)/, 'chat motion should observe viewport changes');
  assert.match(chatPanel, /window\.removeEventListener\('resize', resetForViewport\)/, 'chat motion should clean up the viewport listener');

  assert.match(editorPort, /function selectedTextTargets\(\)/, 'toolbar should resolve selected text targets');
  assert.match(editorPort, /function applyTextToolbarAction\(action: string\)/, 'text toolbar actions should be implemented');
  assert.match(editorPort, /font-plus[\s\S]*font-minus/, 'toolbar should implement font size changes');
  assert.match(editorPort, /action === 'bold'/, 'toolbar should implement bold');
  assert.match(editorPort, /action === 'italic'/, 'toolbar should implement italic');
  assert.match(editorPort, /action\.startsWith\('align-'\)/, 'toolbar should implement alignment buttons');
  assert.match(editorPort, /colorMap\[action\]/, 'toolbar should implement color swatches');
  assert.match(editorPort, /data-edit-action="font-family"/, 'font selector should dispatch through the toolbar action handler');
  assert.match(editorPort, /function replaceSelectedPhoto\(\)/, 'replace-photo should cycle a real book photo instead of being a no-op');
  assert.match(editorPort, /body: JSON\.stringify\(\{\s*imagesJson: page\.imagesJson,/s, 'replace-photo should persist through the page patch API');
  assert.match(editorPort, /function toggleSelectedPhotoFilter\(\)/, 'photo filter should provide visible local feedback');
  assert.match(editorPort, /editBar\?\.addEventListener\('change', onEditBarChange\)/, 'select controls should wire change events');
  assert.match(editorPort, /editBar\?\.removeEventListener\('change', onEditBarChange\)/, 'select controls should clean up change events');
});

test('editor CSS carries the refreshed visual states from the supplied design', () => {
  assert.match(css, /\.editor-port \.page-glow\{/, 'shared glow CSS should be scoped under editor-port');
  assert.match(css, /\.editor-port \.nav-shell\{/, 'nav-shell CSS should be scoped under editor-port');
  assert.match(css, /\.editor-port \.ed-loader\{/, 'full-screen editor entry loader should be available');
  assert.match(css, /\.editor-port \.composer-group\{/, 'composer-group overlap CSS should be present');
  assert.match(css, /\.editor-port \.chat-drag\{/, 'draggable chat header CSS should be present');
  assert.match(css, /position:fixed; left:14px; top:70px; bottom:14px; width:364px/, 'desktop chat card should be fixed and floating');
  assert.match(css, /\.editor-port \.chat-fold-expand \.fab-jelly/, 'collapsed tab jellyfish should be styled');
  assert.match(css, /\.editor-port \.book-stage\.panning/, 'canvas panning state should be styled');
  assert.match(css, /\.editor-port \.el-bar\{/, 'floating element toolbar should be styled');
  assert.match(css, /\.editor-port \.op-card\{/, 'AI operation receipt cards should be styled');
  assert.match(css, /\.editor-port \.thinking-detail\{/, 'expandable thought detail should be styled');
});

test('editor refreshed i18n keys are covered in zh and en dictionaries', () => {
  const zhStart = coordinator.indexOf('  zh: {');
  const enStart = coordinator.indexOf('  en: {');
  assert.notEqual(zhStart, -1, 'zh dictionary should exist');
  assert.notEqual(enStart, -1, 'en dictionary should exist');
  const zhBlock = coordinator.slice(zhStart, enStart);
  const enBlock = coordinator.slice(enStart);
  const keyPattern = /data-i18n(?:-title|-placeholder|-html)?="([^"]+)"/g;
  const keys = new Set(Array.from(src.matchAll(keyPattern), (match) => match[1]));

  for (const key of keys) {
    const definitionPattern = new RegExp(`\\b${escapeRegex(key)}\\s*:`);
    assert.match(zhBlock, definitionPattern, `zh dictionary should include ${key}`);
    assert.match(enBlock, definitionPattern, `en dictionary should include ${key}`);
  }
});
