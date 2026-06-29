import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// §4.2 引导优先 + 满意/不满意 (v3/chapter-guide-satisfaction). EditorPort is one large
// imperative DOM effect with no jsdom harness in this repo (tests run under tsx/node:test),
// so — following the repo's existing source-assertion style (balance-alert-on-mount.test.ts,
// editor-layout.test.ts) — we assert the structural invariants the flow relies on:
//   B. 进章自动引导: an empty-userMessage chapter-chat opener fires on entering an
//      unfinished chapter and on advancing to the next one (AI opens, never auto-writes).
//   C. 满意/不满意: a write turn surfaces the in-flow satisfaction card; 满意 confirms the
//      chapter, 不满意 stays for逐页 adjustment — and the standing「确定本章」breadcrumb
//      button + its post-mount binding effect are gone.

const here = dirname(fileURLToPath(import.meta.url));
function source(file: string): string {
  return readFileSync(join(here, file), 'utf8');
}

test('B: an auto-guide opener exists and posts an empty userMessage (AI opens the chapter)', () => {
  const src = source('EditorPort.tsx');

  // The opener helper exists.
  assert.match(src, /async function runChapterGuideOpener\([^)]*\)/, 'runChapterGuideOpener() must exist');

  // It POSTs a chapter-chat turn with an EMPTY userMessage so the model dispatches a
  // 引导 (talk) question rather than waiting for the user to type first.
  const fn = /async function runChapterGuideOpener\([^)]*\)\s*\{[\s\S]*?\n {4}\}/.exec(src);
  assert.ok(fn, 'runChapterGuideOpener() body must be parseable');
  assert.match(fn![0], /postEditChat\(/, 'opener must call postEditChat');
  assert.doesNotMatch(fn![0], /postChapterChat\(/, 'opener must not call postChapterChat');
  assert.match(fn![0], /userMessage:\s*''/, 'opener must send an empty userMessage (open-the-chapter)');

  // Frame 4 红线: the opener never applies a patch nor advances stage — it only renders
  // the reply. (No applyChapterWrite/applyChapterEdit/markCurrentChapterDone inside it.)
  assert.doesNotMatch(fn![0], /applyChapterWrite|applyChapterEdit|markCurrentChapterDone/,
    'the guide opener must not write/edit pages or confirm the chapter (Frame 4 红线)');
});

test('B: the opener fires on entry (no prior history) and on advancing to the next chapter', () => {
  const src = source('EditorPort.tsx');

  // Entry: after loading history + story-gate, fire the opener only when the chapter has
  // no prior conversation (shown === 0). (#236 added an else-branch that still shows the
  // chapter card on re-entry, but the opener itself stays gated on shown === 0.)
  assert.match(
    src,
    /if \(shown === 0\) \{\s*void runChapterGuideOpener\(\);/,
    'on entry the opener must fire only when this chapter has no prior history',
  );

  // Advance: confirming a chapter that advances to a NEW story chapter opens it with a
  // guide turn (skipped when the last chapter advanced stage→theme).
  assert.match(
    src,
    /if \(advanced && storyGate\.stage !== 'theme'\) \{\s*await runChapterGuideOpener\(\{ allowDuringSend: true \}\);/,
    'advancing to the next story chapter must await the guide opener inside the confirm send lock',
  );

  // Guard against double-prompting: a chapter is only opened once per session.
  assert.match(src, /guidedChapters\.has\(chapterId\)/, 'opener must not re-fire for an already-opened chapter');
});

test('C: a write turn surfaces the satisfaction card (满意/不满意), not on talk/edit', () => {
  const src = source('EditorPort.tsx');

  assert.match(src, /function appendSatisfactionCard\(/, 'appendSatisfactionCard() must exist');

  // Only a real full-chapter WRITE opens the gate — the card is appended behind the
  // wroteChapter flag set by applyChapterWrite's return.
  assert.match(src, /wroteChapter = applyChapterWrite\(res\.pagesTexts\)/,
    'the write-turn result must drive the wroteChapter flag');
  // (#236 ④: the write branch now also drops the write-now exit before the satisfaction
  // card, so the satisfaction card lives inside an `if (wroteChapter) { … }` block.)
  assert.match(src, /if \(wroteChapter && !res\.progressDecision\?\.chapterDone\) \{[\s\S]*?appendSatisfactionCard\(\);/,
    'the satisfaction card must appear only after a successful write turn');
});

test('C: 满意 confirms the chapter; 不满意 stays for逐页 adjustment (no stage推进)', () => {
  const src = source('EditorPort.tsx');
  const card = /function appendSatisfactionCard\([^)]*\)\s*\{[\s\S]*?\n {4}\}/.exec(src);
  assert.ok(card, 'appendSatisfactionCard() body must be parseable');

  // 满意 → edit-chat progressDecision (advance chapter / 末章→主题) inside the acked bundle.
  assert.match(card![0], /confirmCurrentChapterViaEditChat\(\)/,
    '满意 must confirm through edit-chat');

  // 不满意 → stays on the chapter and asks the user which page to change (a talk/引导 ask);
  // it must NOT confirm the chapter or push stage. The existing focusedPageIndex + edit
  // turn machinery then does the逐页 adjustment — so the 不满意 branch itself applies no
  // patch and never advances.
  const noBranch = card![0].slice(card![0].indexOf('sc-no'));
  assert.doesNotMatch(noBranch, /confirmCurrentChapterViaEditChat/,
    '不满意 must NOT confirm the chapter (stays for逐页 adjustment, no stage推进)');
});

test('C: the standing「确定本章」breadcrumb button + its binding effect are removed', () => {
  const src = source('EditorPort.tsx');

  // No story-gate button JSX, no markCurrentChapterDone data-action node, no ref/bind effect.
  assert.doesNotMatch(src, /data-action="markCurrentChapterDone"/,
    'the breadcrumb「确定本章」button (data-action) must be gone');
  assert.doesNotMatch(src, /story-gate-btn/, 'the story-gate button class must no longer be rendered');
  assert.doesNotMatch(src, /markChapterDoneRef/,
    'the post-render ref/binding for the breadcrumb button must be gone');
});

test('focusedPageIndex逐页 edit path is preserved (不满意 reuses it)', () => {
  const src = source('EditorPort.tsx');
  // The edit turn still threads the selected page so "change this page" targets it.
  assert.match(
    src,
    /const focusedPageIndex = authoringFocusPageIndex\(\);/,
    'edit-chat must still send focusedPageIndex for逐页 edit turns',
  );
});
