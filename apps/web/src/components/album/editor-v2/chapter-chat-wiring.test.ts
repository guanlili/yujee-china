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

test('authoring send() routes to the real edit-chat turn', () => {
  // The authoring branch of send() must call runChapterChatTurn, not the legacy
  // /draft-edit single-page loop.
  assert.match(
    src,
    /if \(isAuthoring\) \{\s*await runEditChatTurn\(txt\);/,
    'authoring send() must await runEditChatTurn',
  );
});

test('runEditChatTurn posts the slim edit-chat body (chapterId + focusedPageIndex)', () => {
  const fn = /async function runEditChatTurn\([\s\S]*?\n {4}\}/.exec(src);
  assert.ok(fn, 'runEditChatTurn must exist');
  const body = fn![0];
  assert.match(body, /postEditChat\(albumId, \{/);
  assert.doesNotMatch(body, /postChapterChat\(albumId, \{/);
  assert.match(body, /chapterId,/);
  assert.match(body, /pagePhotoRefs:/);
  assert.match(src, /async function captureChapterPagePhotoRefs/);
  // ③ 改页: the visible authoring page is sent as focusedPageIndex so "this page"
  // still targets something even when the user has not clicked a page.
  assert.match(body, /const focusedPageIndex = authoringFocusPageIndex\(\);/);
  assert.match(body, /focusedPageIndex,/);
});

test('edit-chat applies pagesTexts and patches from the commit bundle', () => {
  const fn = /async function runEditChatTurn\([\s\S]*?\n {4}\}/.exec(src);
  assert.ok(fn, 'runEditChatTurn must exist');
  const body = fn![0];
  assert.match(body, /res\.pagesTexts/);
  assert.match(body, /res\.patches/);
  assert.doesNotMatch(body, /res\.layoutPatch/);
});

test('edit-chat navigation response flips to the requested page', () => {
  const fn = /async function runEditChatTurn\([\s\S]*?\n {4}\}/.exec(src);
  assert.ok(fn, 'runEditChatTurn must exist');
  const body = fn![0];
  assert.match(body, /res\.navigation\?\.pageIndex !== undefined/);
  // Post-refactor the page flip is routed through the coordinator bridge
  // (co()?.goToPageIndex?.(…)), so accept the optional-chained coordinator call too.
  assert.match(body, /goToPageIndex(?:\?\.)?\(res\.navigation\.pageIndex\)/);
});

test('write merges pagesTexts; edit folds layoutPatch via applyPatchToPages', () => {
  const write = /function applyChapterWrite\([\s\S]*?\n {4}\}/.exec(src);
  assert.ok(write, 'applyChapterWrite must exist');
  assert.match(write![0], /page\.textsJson = \{ \.\.\.page\.textsJson, \.\.\.pt\.texts \}/);

  const edit = /function applyChapterEdit\([\s\S]*?\n {4}\}/.exec(src);
  assert.ok(edit, 'applyChapterEdit must exist');
  assert.match(edit![0], /pagesState = applyPatchToPages\(pagesState, layoutPatch\)/);
  assert.match(edit![0], /repaintBook\(\)/);
});

test('edit-chat wiring no longer depends on retired nameOptions chips', () => {
  assert.doesNotMatch(src, /res\.nameOptions/);
});

test('breadcrumb is fed from story-progress (doneChapterIds / currentChapterId)', () => {
  // StageBreadcrumb receives the live story-progress object, which carries the
  // chapter-story gate state (currentChapterId + done set) loaded from GET
  // /api/v3/.../story-progress.
  assert.match(src, /chapterProgress=\{storyProgress\}/);
  assert.match(src, /story-progress`\)/);
});

test('legacy persisted chat replay no longer feeds the edit-chat payload', () => {
  const fn = /async function loadHistory\(\): Promise<number> \{[\s\S]*?\n {4}\}/.exec(src);
  assert.ok(fn, 'loadHistory must exist');
  const body = fn![0];
  assert.match(body, /chapterHistory\.splice\(0, chapterHistory\.length\)/);
  assert.match(body, /chapterHistory\.push\(\{ role: 'user', content: c \}\)/);
  assert.match(body, /chapterHistory\.push\(\{ role: 'assistant', content: c \}\)/);
  const run = /async function runEditChatTurn\([\s\S]*?\n {4}\}/.exec(src);
  assert.ok(run, 'runEditChatTurn must exist');
  assert.doesNotMatch(run![0], /history:/);
});

test('conversation chapter prompt card uses the design .chap-card class without overriding the rail .chapter-card', () => {
  const fn = /function appendChapterCard\(chapterId: string\) \{[\s\S]*?\n {4}\}/.exec(src);
  assert.ok(fn, 'appendChapterCard must exist');
  assert.match(fn![0], /inner\.className = 'chap-card'/);
  assert.doesNotMatch(fn![0], /inner\.className = 'chapter-card'/);

  const chapterCardRuleCount = (css.match(/\.editor-port \.chapter-card\{/g) ?? []).length;
  assert.equal(chapterCardRuleCount, 2, 'only the floating rail plus its scrollbar helper should own .chapter-card');
  assert.doesNotMatch(css, /\.editor-port \.chapter-card \.cc-title/);
});

test('conversation chapter prompt card says the chapter is currently being edited', () => {
  const fn = /function appendChapterCard\(chapterId: string\) \{[\s\S]*?\n {4}\}/.exec(src);
  assert.ok(fn, 'appendChapterCard must exist');
  assert.match(fn![0], /t\('nowEditing'\)/, 'chapter prompt card must tell users this is the active chapter');
  assert.doesNotMatch(fn![0], /t\('justEdited'\)/, 'chapter prompt card must not say "just edited" before the user edits');
});
