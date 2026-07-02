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

// 新流程(逐章收集补充说明 → 全部收集完一次性写全部 → 按页编辑):
// runChapterGuideOpener 现在是「采访链的入口」,启动逐章采访(章节卡片 + startChapterInterview
// 的三条引导气泡);它不再发空 userMessage 让 AI 开场写作。答完一章由 finishInterview 驱动进
// 下一章 / 收尾 writeAllChapters。
test('B: runChapterGuideOpener starts the per-chapter interview (not an empty-message write opener)', () => {
  const src = source('EditorPort.tsx');

  assert.match(src, /async function runChapterGuideOpener\([^)]*\)/, 'runChapterGuideOpener() must exist');
  const fn = /async function runChapterGuideOpener\([^)]*\)\s*\{[\s\S]*?\n {4}\}/.exec(src);
  assert.ok(fn, 'runChapterGuideOpener() body must be parseable');

  // 它启动采访(startChapterInterview),而不是发空 userMessage 让 AI 开场写作。
  assert.match(fn![0], /startChapterInterview\(/, 'opener must start the interview');
  assert.doesNotMatch(fn![0], /userMessage:\s*''/, 'opener no longer sends an empty-message write opener');

  // 采访阶段不写文案/不确认章(收集完才统一写)。
  assert.doesNotMatch(fn![0], /applyChapterWrite|markCurrentChapterDone/,
    'the interview entry must not write pages nor confirm the chapter');
});

test('B: interview collects every chapter first, then writes all chapters in one pass', () => {
  const src = source('EditorPort.tsx');

  // finishInterview 只存 chapterContext,然后进下一章 / 收尾写全部 —— 不再立刻写这一章。
  const fi = /async function finishInterview\([^)]*\)\s*\{[\s\S]*?\n {4}\}/.exec(src);
  assert.ok(fi, 'finishInterview() must be parseable');
  assert.match(fi![0], /postChapterContexts\(/, 'finishInterview stores chapterContext');
  assert.match(fi![0], /nextUninterviewedChapter\(\)/, 'finishInterview advances to the next uninterviewed chapter');
  assert.match(fi![0], /writeAllChapters\(\)/, 'finishInterview writes all chapters once collection is done');
  assert.doesNotMatch(fi![0], /appendSatisfactionCard\(/, 'per-chapter satisfaction card is gone in the interview step');

  // writeAllChapters 遍历所有章逐章写(postWriteChapter + applyChapterWrite)。
  const wa = /async function writeAllChapters\([^)]*\)\s*\{[\s\S]*?\n {4}\}/.exec(src);
  assert.ok(wa, 'writeAllChapters() must be parseable');
  assert.match(wa![0], /postWriteChapter\(/, 'writeAllChapters writes each chapter via postWriteChapter');
  assert.match(wa![0], /applyChapterWrite\(/, 'writeAllChapters lands each chapter’s copy');

  // 采访进度是纯前端的(interviewedChapters),不靠服务端 done 推进。
  assert.match(src, /const interviewedChapters = new Set/, 'interview progress tracked client-side');
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
