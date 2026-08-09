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
  assert.match(editorPort, /\.className = 'img-edit-reset'/, 'photo editing overlay should include a real reset action');
  // 画布模式下 #book 是 display:none —— 图片浮层必须挂到 .book-stage(#book 父级)且 position:fixed,
  // 否则缩放/复位控件 0×0 不可见(回归:曾挂在 #book 上,靠合成事件驱动滑块把这个 bug 藏住了)。
  assert.match(css, /\.img-edit-overlay\{[^}]*position:fixed/, 'photo overlay must be position:fixed so it is visible in canvas mode where #book is hidden');
  assert.match(editorPort, /\(bookEl\.parentElement \?\? bookEl\)\.appendChild\(ov\)/, 'photo overlay must attach to the always-visible .book-stage, not the hidden #book');
  assert.match(editorPort, /function positionImgEditOverlay\(\)[\s\S]*?setFixedPos\(ov,/, 'photo overlay must be positioned in viewport coords via setFixedPos (like #elBar)');
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
  assert.match(building, /\{buildingStageLabel\(generation\?\.stage, locale\)\}/, 'live stage copy should live inside the chat panel');
  // 识图砍掉后 analyze 只发 'group'(0→100);select-layout 只发 'layout' 就直接
  // completed 带完整 pages,没有 'describe'/'template'/'preview' 这些死分支。
  assert.match(editorPort, /case 'group':\s*return aT\('正在整理这些瞬间…'/, 'group-stage copy must carry the first beat the user sees');
  assert.doesNotMatch(editorPort, /case '(describe|template|preview)':/, "analyze/select-layout 不再发这些 stage,别留死分支");
  assert.doesNotMatch(building, /building-chat-placeholder/, 'building chat rail should not be an empty placeholder while the album is being built');
  assert.doesNotMatch(building, /<BuildingCanvasState locale=\{locale\} generation=\{generation\}/, 'canvas should not receive stage-specific progress copy');
  assert.doesNotMatch(building, /className="canvas-hint"/, 'building canvas should not show a second loading hint');
  assert.doesNotMatch(editorPort.match(/function BuildingCanvasState[\s\S]*?\n}\n\n\/\/ ── authoring/)?.[0] ?? '', /buildingStageLabel/, 'canvas loading must not reuse live stage labels');
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

test('Live 图导出共用一个出口,九宫格只出单页', () => {
  assert.match(editorPort, /add\(byId\('nineGridModal'\)\)/, 'nine-grid modal must be included when binding data-action controls');
  // 术语按产品要求统一成「Live」——「动态图片 / motion」用户看不懂。
  // 这里原本钉的是「动态图片」,理由是「桌面导出的是普通视频、不是苹果原生 Live Photo,
  // 叫 Live 会过度承诺」。那个顾虑是真的,但产品拍板用 Live:文案里只说「Live 视频」、
  // 不说「Live Photo」,不宣称能直接生成苹果原生格式;iOS 那条走分享面板给出 jpg + 视频
  // 成对素材,用户自己合成 Live Photo。改文案时请守住这条边界。
  assert.match(editorPort, /Live 图/, 'Live 图导出应当用 Live 这个词,不再用「动态图片」');
  assert.doesNotMatch(editorPort, /动态图片|Motion image/, '「动态图片 / Motion image」这套旧术语不该回来');
  // 只查用户可见文案 —— 注释里讨论 Live Photo 是可以的(iOS 那条本来就在拼它)。
  const copy = editorPort.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(copy, /Live Photo/, '不要宣称直接产出苹果原生 Live Photo —— 桌面拿到的是视频');
  assert.match(editorPort, /翻页 Live/, 'the original page-flip export should use a Live label');
  assert.match(editorPort, /九宫格 Live/, 'the nine-grid export should use a Live label');
  assert.match(editorPort, /motion-example-flip/, 'page-flip choice should include a visual motion example');
  assert.match(editorPort, /motion-example-grid/, 'nine-grid choice should include a visual motion example');
  assert.match(editorPort, /aria-pressed="true"/, 'the selected example should expose its pressed state');
  assert.match(editorPort, /data-live-style="flip"/, 'Live modal should offer the page-flip animation');
  assert.match(editorPort, /data-live-style="nine-grid"/, 'Live modal should offer the nine-grid animation');
  assert.match(editorPort, /liveStyle === 'flip' \? exportLive\(\) : exportNineGrid\(\)/, 'the selected Live style should invoke its exporter');
  assert.doesNotMatch(editorPort, /data-nine-grid-layout="spread"/, 'nine-grid export must not offer spread mode');
  assert.doesNotMatch(editorPort, /data-nine-grid-aspect=/, 'fixed 3:4 output should not expose a format control');
  assert.doesNotMatch(editorPort, /data-nine-grid-frame=/, 'fixed full-bleed output should not expose a frame control');
  assert.match(editorPort, /renderNineGridLayoutSources\([\s\S]*?'single'/, 'nine-grid video sources should use rendered single pages');
  assert.match(editorPort, /aspect: '3:4',\s*frameStyle: 'full'/, 'nine-grid output should stay fixed at 3:4 full bleed');
  assert.match(editorPort, /columns: 3,\s*layoutsPerScene: 9/, 'nine-grid mode should use three columns and nine pages per scene');
  assert.match(editorPort, /renderNineGridCover\(/, 'Live bundle should include a generated still cover');
  // 分享面板与「桌面只下一个文件」的规则已抽到 lib/export/live-delivery(移动端同用一份),
  // 这里只管调用侧接上了它;规则本身守在 export-download-wiring.test.ts。
  assert.match(editorPort, /import\('@\/lib\/export\/live-delivery'\)/, 'Live 交付应当走共享实现');
  // 这条原本钉的是 downloadBlobs(「其他设备应当同时拿到 MP4 和 JPG」)—— 那正是线上事故:
  // 连续两次自动下载会被桌面 Chrome 的站点级「自动下载多个文件」权限拦掉,拦掉之后**静默**
  // 失效,表现为「第一次能下、之后进度跑完但没文件」。桌面因此只交付视频(封面已经是视频
  // 第一帧,单独给是冗余)。
  // 不在这里断言 downloadBlobs 的存废 —— 单页图/拼图导出的产物天然就是 N 个文件,那条路径
  // 该用它。这条不变量只属于 Live 交付,按函数体精确守在 export-download-wiring.test.ts。
  // 背景必须用用户在画板上选的那个,与拼图导出同口径 —— 不能只认纯色、其余回落写死色值。
  assert.match(editorPort, /background: boardBg,/, 'Live 导出应当吃完整的相册垫底背景');
  assert.doesNotMatch(copy, /#c9c5b9/, '写死的兜底底色不该再出现在调用侧(注释里复盘它可以)');
  assert.doesNotMatch(editorPort, /即将打开苹果系统分享|当前浏览器不能共享成对素材/, 'Live delivery should not interrupt users with platform guidance');
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
  // 工具条 2026-07 重做:字号=可编辑输入+预设,颜色=自定义取色,字体=带搜索的项目字体面板。
  assert.match(editorPort, /function applyFontSizeToSelection\(px: number\)/, 'toolbar should implement font size changes (editable size + presets)');
  assert.match(editorPort, /data-edit-action="font-size-input"/, 'toolbar should expose the editable font-size input');
  assert.match(editorPort, /action === 'bold'/, 'toolbar should implement bold');
  assert.match(editorPort, /action === 'italic'/, 'toolbar should implement italic');
  assert.match(editorPort, /action\.startsWith\('align-'\)/, 'toolbar should implement alignment buttons');
  assert.match(editorPort, /function applyColorToSelection\(hex: string\)/, 'toolbar should implement a custom color picker');
  assert.match(editorPort, /data-edit-action="color-open"/, 'toolbar should expose the custom color popover trigger');
  assert.match(editorPort, /function buildColorPanel\(\)/, 'color popover (SV + hue/alpha + swatches + hex) should be built');
  assert.match(editorPort, /function positionEbPanel\(panel: HTMLElement\)/, 'dropdown panels should be positioned above the toolbar within the viewport');
  // 字体表已抽到 editor-fonts(移动端弹窗同用一份)。契约不变:必须列全项目目录字体,
  // 且桌面用的就是那一份 —— 两边各列一套迟早漂移。
  assert.match(
    readFileSync(join(here, 'editor-fonts.ts'), 'utf8'),
    /export const EDITOR_FONTS: EditorFont\[\]/,
    'font picker should list all project catalog fonts (now in editor-fonts.ts)',
  );
  assert.match(editorPort, /from '\.\/editor-fonts'/, 'EditorPort must consume the shared font table');
  assert.match(editorPort, /function applyFontToSelection\(font: EditorFont\)/, 'selecting a font should apply its web stack + patch html');
  assert.match(editorPort, /data-edit-action="font-open"/, 'font trigger should open the searchable font panel');
  assert.match(editorPort, /data-edit-action="edit-text"/, 'text toolbar should include the edit text control from the design');
  // 图片编辑全在浮层里:缩放滑块 + 拖动平移 + 复位 + 换图 + 删除。旧的 el-bar 照片工具条
  // (data-edit-action="replace-photo"/"delete-photo")与黑白滤镜仍然不该回来 —— 换图/删除
  // 是浮层里的 img-edit-swap / img-edit-del,与移动端选中框旁那条 .mimg-bar 同一组动作。
  assert.match(editorPort, /\.className = 'img-edit-zoom'/, 'photo editing keeps the zoom (size) slider in the overlay');
  assert.match(editorPort, /\.className = 'img-edit-reset'/, 'photo editing keeps a reset (position + zoom) control');
  assert.match(editorPort, /\.className = 'img-edit-swap'/, 'photo overlay must expose replace-photo (parity with mobile)');
  assert.match(editorPort, /\.className = 'img-edit-del'/, 'photo overlay must expose delete-photo (parity with mobile)');
  assert.doesNotMatch(editorPort, /data-edit-action="photo-filter"/, 'black & white filter should be removed');
  assert.doesNotMatch(editorPort, /toggleSelectedPhotoFilter/, 'black & white filter code should be removed');
  assert.doesNotMatch(editorPort, /data-edit-action="delete-photo"/, 'delete-photo should not come back to the el-bar');
  assert.doesNotMatch(editorPort, /data-edit-action="replace-photo"/, 'replace-photo should not come back to the el-bar');
  // 单独编辑不联动:只改被选中的那一个文字节点,不 querySelectorAll 整页文字。
  assert.match(editorPort, /return editBarAnchor\.matches\('\[data-editable\]:not\(img\)'\) \? \[editBarAnchor\] : \[\];/, 'style tools must target only the selected text, never the whole page');
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
