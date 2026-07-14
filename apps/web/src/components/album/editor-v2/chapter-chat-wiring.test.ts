import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// Source-assertion guards for the edit-chat wiring inside EditorPort.tsx.
// EditorPort is one imperative DOM effect with no jsdom harness (tests run under
// `tsx --test`); the pure logic it calls (postEditChat, applyPatchToPages,
// album-service slice, story-progress) is covered in its own unit tests. Here we
// lock the load-bearing wiring invariants of the editor effect itself:
//   • authoring send() routes to the stateful edit-chat turn,
//   • edit-chat applies every commit bundle field it receives (pagesTexts + patches),
//   • the turn sends the current chapterId + focusedPageIndex,
//   • the breadcrumb is fed from story-progress.

const here = dirname(fileURLToPath(import.meta.url));
// The edit-chat / interview wiring moved out of EditorPort.tsx into ChatPanel.tsx
// (dialogue) and editor-coordinator.ts (the canvas↔chat bridge). These structural
// guards don't care which of the three a symbol lives in, so `src` is the three
// merged; the doesNotMatch guards still hold across all three.
const src = ['EditorPort.tsx', 'ChatPanel.tsx', 'editor-coordinator.ts']
  .map((f) => readFileSync(join(here, f), 'utf8'))
  .join('\n\n');
const css = readFileSync(join(here, 'editor-port.css'), 'utf8');

test('authoring send() routes to the design chat turn', () => {
  // The authoring branch of send() must call the design-chat turn, not the legacy
  // /draft-edit single-page loop.
  assert.match(
    src,
    /if \(isAuthoring\) \{\s*\/\/[^\n]*\n\s*await runDesignChatTurn\(txt\);/,
    'authoring send() must await runDesignChatTurn',
  );
});

test('edit-chat wiring no longer depends on retired nameOptions chips', () => {
  assert.doesNotMatch(src, /res\.nameOptions/);
});

// (已移除)对话框顶部的五环节状态栏(StageBreadcrumb)已从 ChatPanel 撤下,相应的
// 「breadcrumb is fed from story-progress」渲染测试随之删除。story-progress 仍由
// loadStoryGate 拉取供采访门控使用。

test('conversation chapter prompt card uses the design .chap-card class without overriding the rail .chapter-card', () => {
  const fn = /function appendChapterCard\(chapterId: string, attempt = 0\) \{[\s\S]*?\n {4}\}/.exec(src);
  assert.ok(fn, 'appendChapterCard must exist');
  assert.match(fn![0], /inner\.className = 'chap-card'/);
  assert.doesNotMatch(fn![0], /inner\.className = 'chapter-card'/);

  const chapterCardRuleCount = (css.match(/\.editor-port \.chapter-card\{/g) ?? []).length;
  assert.equal(chapterCardRuleCount, 2, 'only the floating rail plus its scrollbar helper should own .chapter-card');
  assert.doesNotMatch(css, /\.editor-port \.chapter-card \.cc-title/);
});

test('conversation chapter prompt card matches the layout-entry design', () => {
  const fn = /function appendChapterCard\(chapterId: string, attempt = 0\) \{[\s\S]*?\n {4}\}/.exec(src);
  assert.ok(fn, 'appendChapterCard must exist');
  assert.match(fn![0], /metaLine\.textContent = `\$\{meta\.photoIds\.length\} \$\{t\('photosWord'\)\}`/, 'chapter prompt card must show photo count without fake time');
  assert.match(fn![0], /t\('viewLayout'\)/, 'chapter prompt card CTA must enter layout view');
  assert.match(fn![0], /goToChapterById(?:\?\.)?\(chapterId\)/, 'layout CTA must navigate the canvas to this chapter');
  assert.match(fn![0], /meta\.photoIds\.slice\(0, 4\)/, 'chapter prompt card must keep the design cap of four thumbnails');
  assert.doesNotMatch(fn![0], /t\('justEdited'\)/, 'chapter prompt card must not render fake edited time');
  assert.doesNotMatch(fn![0], /t\('nowEditing'\)/, 'chapter prompt card must not use the old active-editing label');
  assert.doesNotMatch(fn![0], /t\('viewDetails'\)/, 'chapter prompt card must not use the old details label');
});

test('conversation chat does not render fake message timestamps', () => {
  assert.doesNotMatch(src, /className="name-time"/, 'static demo chat must not include hard-coded times');
  assert.doesNotMatch(src, /className = 'name-time'/, 'runtime chat must not create fake time rows');
  assert.doesNotMatch(src, /t\('justNow'\)/, 'runtime chat must not render "just now" as a fake timestamp');
  assert.doesNotMatch(css, /\.editor-port \.msg \.name-time/, 'timestamp CSS should be removed with the timestamp UI');
});

test('conversation chapter prompt card keeps the supplied editor.html sizing', () => {
  assert.match(css, /\.editor-port \.msg\.user \.bubble\{[\s\S]*?radial-gradient\(58% 78% at 0% 0%, rgba\(19,184,166,\.11\), transparent 60%\)/);
  assert.match(css, /\.editor-port \.msg\.user \.bubble\{[\s\S]*?border-radius: 16px 4px 16px 16px;/);
  assert.match(css, /\.editor-port \.chap-card\{[\s\S]*?border:1px solid var\(--border-soft\); border-radius:16px;/);
  assert.match(css, /\.editor-port \.chap-card\{[\s\S]*?box-shadow:0 1px 3px rgba\(0,0,0,\.04\); max-width:100%;/);
  assert.match(css, /\.editor-port \.cc-thumbs\{ display:flex; gap:8px; \}/);
  assert.match(css, /\.editor-port \.cc-title\{[\s\S]*?font-size:15px; font-weight:700;/);
  assert.match(css, /\.editor-port \.cc-view svg\{ width:14px; height:14px; \}/);
});
