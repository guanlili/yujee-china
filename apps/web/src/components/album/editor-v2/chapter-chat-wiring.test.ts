import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// 缺口#20 source-assertion guards for the chapter-chat wiring inside EditorPort.tsx.
// EditorPort is one imperative DOM effect with no jsdom harness (tests run under
// `tsx --test`); the pure logic it calls (postChapterChat, applyPatchToPages,
// album-service slice, story-progress) is covered in its own unit tests. Here we
// lock the load-bearing wiring invariants of the editor effect itself:
//   • authoring send() routes to the real chapter-chat turn (not the legacy stub),
//   • talk applies NO patch (Frame 4 红线), write applies pagesTexts, edit applies
//     layoutPatch,
//   • the turn sends the current chapterId + focusedPageIndex,
//   • nameOptions render as picker chips,
//   • the breadcrumb is fed from story-progress.

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, 'EditorPort.tsx'), 'utf8');
const css = readFileSync(join(here, 'editor-port.css'), 'utf8');

test('authoring send() routes to the real chapter-chat turn', () => {
  // The authoring branch of send() must call runChapterChatTurn, not the legacy
  // /draft-edit single-page loop.
  assert.match(
    src,
    /if \(isAuthoring\) \{\s*await runChapterChatTurn\(txt\);/,
    'authoring send() must await runChapterChatTurn',
  );
});

test('runChapterChatTurn posts the live chapter slice (chapterId + focusedPageIndex)', () => {
  const fn = /async function runChapterChatTurn\([\s\S]*?\n {4}\}/.exec(src);
  assert.ok(fn, 'runChapterChatTurn must exist');
  const body = fn![0];
  assert.match(body, /postChapterChat\(albumId, \{/);
  assert.match(body, /chapterId,/);
  // ③ 改页: the selected page is sent as focusedPageIndex so "this page" targets it.
  assert.match(body, /selectedPageIndex != null \? \{ focusedPageIndex: selectedPageIndex \}/);
});

test('Frame 4 红线: a talk turn applies NO patch — only write/edit mutate pages', () => {
  const fn = /async function runChapterChatTurn\([\s\S]*?\n {4}\}/.exec(src);
  assert.ok(fn, 'runChapterChatTurn must exist');
  const body = fn![0];
  // write → pagesTexts; edit → layoutPatch; talk has no apply* branch.
  assert.match(body, /res\.kind === 'write' && res\.pagesTexts/);
  assert.match(body, /res\.kind === 'edit' && res\.layoutPatch/);
  // The only patch-applying branches are guarded by write/edit. Assert talk is never
  // a key on a branch that applies a patch: there must be no `kind === 'talk'` apply.
  assert.doesNotMatch(body, /kind === 'talk'[\s\S]{0,80}(applyChapterWrite|applyChapterEdit)/);
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

test('nameOptions render as picker chips that re-run a chapter-chat turn', () => {
  const fn = /function appendNameChips\([\s\S]*?\n {4}\}/.exec(src);
  assert.ok(fn, 'appendNameChips must exist');
  const body = fn![0];
  assert.match(body, /class.*chip-select|chip-select/);
  assert.match(body, /runChapterChatTurn\(/);
  // The turn calls appendNameChips when the agent returns nameOptions.
  assert.match(src, /res\.nameOptions && res\.nameOptions\.length > 0[\s\S]{0,80}appendNameChips/);
});

test('breadcrumb is fed from story-progress (doneChapterIds / currentChapterId)', () => {
  // StageBreadcrumb receives the live story-progress object, which carries the
  // chapter-story gate state (currentChapterId + done set) loaded from GET
  // /api/v3/.../story-progress.
  assert.match(src, /chapterProgress=\{storyProgress\}/);
  assert.match(src, /story-progress`\)/);
});

test('replayed persisted chat messages hydrate the next chapter-chat history payload', () => {
  const fn = /async function loadHistory\(\): Promise<number> \{[\s\S]*?\n {4}\}/.exec(src);
  assert.ok(fn, 'loadHistory must exist');
  const body = fn![0];
  assert.match(body, /chapterHistory\.splice\(0, chapterHistory\.length\)/);
  assert.match(body, /chapterHistory\.push\(\{ role: 'user', content: c \}\)/);
  assert.match(body, /chapterHistory\.push\(\{ role: 'assistant', content: c \}\)/);
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
