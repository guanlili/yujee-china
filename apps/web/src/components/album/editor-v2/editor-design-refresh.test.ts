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
const albumPage = readFileSync(join(here, '../../../app/[locale]/album/[uuid]/page.tsx'), 'utf8');
const src = `${editorPort}\n\n${chatPanel}`;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function funcBody(name: string): string {
  const match = editorPort.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n}\\n\\n`));
  assert.ok(match, `${name} should exist in EditorPort`);
  return match[0];
}

function editorAuthoringSource(): string {
  const match = editorPort.match(/function EditorAuthoring\([\s\S]*?\n}\n\n\/\/ ═+[\s\S]*?EditorShell/);
  assert.ok(match, 'EditorAuthoring should exist before EditorShell');
  return match[0];
}

test('editor shell uses the supplied unified top chrome and canvas hints', () => {
  assert.match(src, /className="page-glow"/, 'editor should render the shared top glow');
  assert.match(src, /className="topbar nav-shell sticky top-0 z-50 h-14/, 'topbar should use the refreshed translucent nav shell');
  assert.match(src, /height: 'calc\(100vh - 56px\)'/, 'workspace height should match the 56px refreshed topbar');
  // 账户菜单统一为 <UserMenu>(与 landing/my-albums 同组件);头像在 UserMenu 内部,
  // 编辑页开 showLangSwitch 保留菜单内 EN/中文 切换。
  assert.match(editorPort, /<UserMenu user=\{session\.user\} locale=\{locale\} showLangSwitch \/>/, 'editor account menu should use the unified UserMenu');
  assert.match(editorPort, /<BuildingCanvasState locale=\{locale\} \/>/, 'building editor canvas should stay generic while chat shows AI progress');
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
  assert.match(chatPanel, /<svg viewBox="0 0 24 24" width="13" height="13"[\s\S]*?<path d="M21 15 15 21M21 9 9 21"/, 'resize handle should use the supplied diagonal grip, not a centered corner icon');
  assert.match(chatPanel, /function bindChatMotion\(\)/, 'drag and resize handles should be wired to deterministic client-side motion');
  assert.match(chatPanel, /dragHandle(?:El)?\.addEventListener\('pointerdown'/, 'desktop drag handle should listen for pointer drag');
  assert.match(chatPanel, /resizeHandle(?:El)?\.addEventListener\('pointerdown'/, 'desktop resize handle should listen for pointer resize');
  assert.match(chatPanel, /className="composer-group/, 'composer and purchase banner should be grouped for the overlap treatment');
  assert.match(chatPanel, /className="buy-banner"/, 'purchase prompt should use the refreshed banner instead of the old card');
  assert.doesNotMatch(chatPanel, /data-demo-chat/, 'production chat rail must not ship design-demo transcript bubbles');
  assert.doesNotMatch(chatPanel, /clearDemoChat/, 'demo transcript cleanup should not be needed when the demo transcript is not rendered');
  assert.doesNotMatch(chatPanel, /thinkingAnalyzed|aiMsg1|userMsg1/, 'demo transcript i18n keys should not be referenced by ChatPanel markup');
  assert.match(chatPanel, /function appendStep\(/, 'runtime AI tool progress should be emitted by real step rows');
  assert.match(chatPanel, /card\.className = 'op-card op-card-change'/, 'design turn should render one colored “what changed” summary bar (op-card family), not per-tool receipts');
  assert.doesNotMatch(chatPanel, /className="ai-doc"/, 'design-demo document summaries should not ship in the chat rail');
});

test('building loading keeps the canvas generic and puts photo-reading status inside the refreshed chat panel', () => {
  // The refreshed chrome (drag header, mobile handle, composer, resize grip) lives
  // in the shared StaticEditorShell that BOTH building and the terminal-error state
  // render through — one chrome, no stale second full-page error layout.
  const shell = funcBody('StaticEditorShell');
  const building = funcBody('BuildingShell');

  assert.match(shell, /className="chat-drag hidden md:flex/, 'shared shell should use the refreshed draggable header');
  assert.match(shell, /className="chat-mobile-handle md:hidden/, 'shared shell should use the refreshed mobile handle');
  assert.match(shell, /className="composer-group shrink-0"/, 'shared shell should use the refreshed composer wrapper');
  assert.match(shell, /className="chat-resize" id="chatResize"/, 'shared shell should keep the refreshed resize grip');
  assert.doesNotMatch(shell, /chat-input m-3 shrink-0[^"]*rounded-pill flex items-end/, 'shared shell must not keep the old pill input shell');

  // Building renders through that shell with a generic canvas + live AI status.
  assert.match(building, /<StaticEditorShell/, 'building should render through the shared static shell');
  assert.match(building, /<BuildingCanvasState locale=\{locale\} \/>/, 'building canvas should keep only a generic loading state');
  assert.match(building, /thinking-block active/, 'building chat rail should carry the live AI loading status');
  assert.match(building, /className="think-jelly" src="\/jellyfish-loop\.png"/, 'building chat loading should use the small jellyfish, not the big canvas illustration');
  assert.match(building, /\{buildingStageLabel\(generation\?\.stage, locale\)\}/, 'photo-reading stage copy should live inside the chat panel');
  assert.match(editorPort, /case 'describe':\s*return zh \? '正在看照片…'/, 'describe-stage copy should say the AI is looking at photos');
  assert.doesNotMatch(building, /building-chat-placeholder/, 'building chat rail should not be an empty placeholder while AI is reading photos');
  assert.doesNotMatch(building, /<BuildingCanvasState locale=\{locale\} generation=\{generation\}/, 'canvas should not receive stage-specific photo-reading copy');
  assert.doesNotMatch(building, /className="canvas-hint"/, 'building canvas should not show a second loading hint');
  assert.doesNotMatch(editorPort.match(/function BuildingCanvasState[\s\S]*?\n}\n\n\/\/ ── authoring/)?.[0] ?? '', /buildingStageLabel/, 'canvas loading must not reuse photo-reading stage labels');
});

test('terminal error states render through the same static chrome as building, not a separate page layout', () => {
  // W10 flow unification: the old full-page AlbumGeneratingShell error layout is
  // retired. failed/gone/error all flow through EditorPort mode="error".
  assert.doesNotMatch(albumPage, /AlbumGeneratingShell/, 'album page must not fall back to the retired generating shell');
  assert.match(albumPage, /phase === 'failed' \|\| phase === 'gone' \|\| phase === 'error'/, 'terminal errors should be routed together');
  assert.match(albumPage, /mode="error"[\s\S]*?errorKind=\{phase\}/, 'terminal errors should render through EditorPort mode="error"');

  const errorShell = funcBody('ErrorShell');
  assert.match(errorShell, /<StaticEditorShell/, 'error state should render through the shared static shell');
  assert.match(errorShell, /<YujeeState variant="error"/, 'error state should use the shared error illustration');
  assert.match(errorShell, /<RetryFailedButton albumId=\{albumId\} \/>/, 'FAILED errors should keep the retry action');
  assert.match(editorPort, /if \(mode === 'error'\) \{[\s\S]*?<ErrorShell/, 'EditorPort should dispatch error mode to the error shell');
});

test('resource loading uses the full-screen loading state before showing canvas or chat', () => {
  const authoring = editorAuthoringSource();

  assert.match(editorPort, /export type EditorMode = 'loading' \| 'building' \| 'authoring' \| 'editing'/, 'EditorPort should distinguish resource loading from AI waiting');
  assert.match(editorPort, /function EditorLoadingState\(/, 'editor should have a full-screen resource loader');
  assert.match(editorPort, /<YujeeState\s+variant="loading"/, 'full-screen resource loading should use the supplied loading illustration');
  assert.match(editorPort, /if \(mode === 'loading'\) \{[\s\S]*?<EditorLoadingState locale=\{locale\} \/>/, 'loading mode should render only the full-screen loading state');
  assert.match(albumPage, /if \(phase === 'loading'\) \{[\s\S]*?mode="loading"/, 'first poll frame should show the full-screen resource loader');
  assert.match(albumPage, /if \(phase === 'running'\) \{[\s\S]*?mode="building"/, 'AI running should still use the building/chat waiting state');
  assert.doesNotMatch(albumPage, /phase === 'loading' \|\| phase === 'running'/, 'resource loading and AI waiting must not share one editor state');
  assert.match(authoring, /if \(loadState !== 'ready' \|\| !skeleton\) \{[\s\S]*?return <EditorLoadingState locale=\{locale\} \/>/, 'draft skeleton/image resource loading should be full-screen');
  assert.doesNotMatch(authoring, /return <BuildingShell detail=\{detail\} locale=\{locale\} generation=\{null\} \/>/, 'draft resource loading must not show the AI waiting chat panel');
});

test('chat collapse button is clickable inside the draggable header', () => {
  assert.match(
    chatPanel,
    /<button[^>]*type="button"[^>]*className="chat-fold-btn chat-fold-collapse/,
    'collapse control must be a plain button, not an implicit submit button',
  );
  assert.match(
    chatPanel,
    /const onDragDown = \(e: PointerEvent\) => \{[\s\S]*?closest\('\[data-action\], button, a, input, textarea, select'\)[\s\S]*?return;/,
    'chat drag handler must not intercept clicks on data-action controls inside the header',
  );
});

test('editor motion and toolbar controls are functional, not empty chrome', () => {
  assert.match(chatPanel, /function resetForViewport\(\) \{\s*if \(!desktop\(\)\) resetChatPos\(\);/s, 'desktop drag inline styles should clear when resizing to mobile');
  assert.match(chatPanel, /window\.addEventListener\('resize', resetForViewport\)/, 'chat motion should observe viewport changes');
  assert.match(chatPanel, /window\.removeEventListener\('resize', resetForViewport\)/, 'chat motion should clean up the viewport listener');

  assert.match(editorPort, /function selectedTextTargets\(\)/, 'toolbar should resolve selected text targets');
  assert.match(editorPort, /function applyTextToolbarAction\(action: string\)/, 'text toolbar actions should be implemented');
  assert.match(editorPort, /function editSelectedText\(\)/, 'text edit button should enter real contenteditable editing');
  assert.match(editorPort, /setAttribute\('contenteditable', 'true'\)/, 'text edit mode should mark the selected text as contenteditable');
  assert.match(editorPort, /page\.textsJson = \{ \.\.\.page\.textsJson, \[textKey\]: nextText \}/, 'text edit blur should persist edited copy through textsJson');
  assert.match(editorPort, /syncPageHtml\(page, \(html\) => patchHtmlText\(html, textKey, nextText\)\)/, 'text edit blur must also patch the html truth (C 方案:只写 textsJson 会被旧 html 吃掉)');
  assert.match(editorPort, /font-plus[\s\S]*font-minus/, 'toolbar should implement font size changes');
  assert.match(editorPort, /action === 'bold'/, 'toolbar should implement bold');
  assert.match(editorPort, /action === 'italic'/, 'toolbar should implement italic');
  assert.match(editorPort, /action\.startsWith\('align-'\)/, 'toolbar should implement alignment buttons');
  assert.match(editorPort, /colorMap\[action\]/, 'toolbar should implement color swatches');
  assert.match(editorPort, /data-edit-action="font-family"/, 'font selector should dispatch through the toolbar action handler');
  assert.match(editorPort, /data-edit-action="edit-text"/, 'text toolbar should include the edit text control from the design');
  assert.match(editorPort, /function replaceSelectedPhoto\(\)/, 'replace-photo should cycle a real book photo instead of being a no-op');
  assert.match(editorPort, /function deleteSelectedPhoto\(\)/, 'delete-photo should remove the selected image from the page JSON');
  assert.match(editorPort, /data-edit-action="delete-photo"/, 'photo toolbar should include delete-photo');
  assert.match(editorPort, /delete page\.imagesJson\[imgEdit\.slotId\]/, 'delete-photo should delete the selected slot from imagesJson');
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
  assert.match(css, /\.editor-port \.chat-resize\{[\s\S]*align-items:flex-end; justify-content:flex-end; padding:2px;/, 'resize handle should sit as a bottom-right grip instead of a centered icon');
  assert.match(css, /position:fixed; left:14px; top:70px; bottom:14px; width:364px/, 'desktop chat card should be fixed and floating');
  assert.match(css, /\.editor-port \.chat-fold-expand \.fab-jelly/, 'collapsed tab jellyfish should be styled');
  assert.match(css, /\.editor-port \.chat-fold-btn:hover\{[^}]*\}\s*\.editor-port \.chat-fold-expand\{\s*display:none;/, 'collapsed chat entry should be hidden until the chat is collapsed');
  assert.match(css, /\.editor-port \.chat-fold-expand\{[^}]*background:var\(--fg\);/, 'collapsed chat entry should use the black button from the design note');
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
