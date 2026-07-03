import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// Source-assertion guards for the 「确定本章」 confirm→advance wiring in EditorPort.tsx.
// Stage3 routes chapter confirmation through edit-chat so the Agent returns a
// progressDecision inside the acked commit bundle; story-progress remains a read
// projection only. EditorPort is one imperative DOM effect with no jsdom harness
// (tests run under `tsx --test`), so we lock the load-bearing wiring invariants as
// source assertions.

const here = dirname(fileURLToPath(import.meta.url));
// The confirm→advance / interview wiring moved out of EditorPort.tsx into
// ChatPanel.tsx (dialogue) and editor-coordinator.ts (the canvas↔chat bridge).
// These structural guards don't care which of the three a symbol lives in, so `src`
// is the three merged; the doesNotMatch guards still hold across all three.
const src = ['EditorPort.tsx', 'ChatPanel.tsx', 'editor-coordinator.ts']
  .map((f) => readFileSync(join(here, f), 'utf8'))
  .join('\n\n');

test('confirm-chapter has no breadcrumb button: it is driven by the in-flow satisfaction card', () => {
  // §4.2: the standing「确定本章」button is gone. Confirm must NOT be wired
  // in the data-action actions map (no DOM button to bind)…
  const actionsMap = /const actions: Record<string, \(\) => void> = \{[\s\S]*?\n {4}\};/.exec(src);
  assert.ok(actionsMap, 'the data-action actions map must exist');
  assert.doesNotMatch(
    actionsMap![0],
    /^\s*confirmCurrentChapterViaEditChat,\s*$/m,
    'confirmCurrentChapterViaEditChat must not be wired in the mount-time actions map (no breadcrumb button)',
  );

  // …and the old post-render binding effect + ref are removed entirely.
  assert.doesNotMatch(src, /markChapterDoneRef/, 'the breadcrumb-button ref/binding must be gone');
  assert.doesNotMatch(
    src,
    /data-action="confirmCurrentChapterViaEditChat"/,
    'no DOM node should carry the confirmCurrentChapterViaEditChat data-action anymore',
  );

  // The in-flow satisfaction card's 满意 button confirms through edit-chat.
  const card = /function appendSatisfactionCard\([^)]*\)\s*\{[\s\S]*?\n {4}\}/.exec(src);
  assert.ok(card, 'appendSatisfactionCard() must exist');
  assert.match(card![0], /confirmCurrentChapterViaEditChat\(\)/, '满意 must call confirmCurrentChapterViaEditChat');
});

test('confirming a chapter uses edit-chat, not story-progress POST', () => {
  const fn = /async function confirmCurrentChapterViaEditChat\(\)[\s\S]*?\n {4}\}/.exec(src);
  assert.ok(fn, 'confirmCurrentChapterViaEditChat must exist');
  const body = fn![0];
  assert.match(body, /runEditChatTurn\(/, 'confirm must go through the acked edit-chat turn');
  assert.match(
    body,
    /runEditChatTurn\(CONFIRM_CHAPTER_COMMAND\)/,
    'confirm must send an explicit internal command, not natural-language praise',
  );
  assert.doesNotMatch(src, /story-progress`, \{\s*method: 'POST'/, 'EditorPort must not POST story-progress');
});

test('laid-out story chapters enter the edit-loop chat, not the confirmation card', () => {
  assert.match(
    src,
    /latestAuthoringRef\.current = \{ draftChapters, storyProgress, mode \};/,
    'ChatPanel must keep latest authoring props visible to its stable DOM effect',
  );
  assert.match(
    src,
    /function appendEditLoopReadyCard\(chapterId: string\)[\s\S]*?data-edit-loop-ready/,
    'laid-out chapters must surface the edit-loop opening prompt',
  );
  assert.doesNotMatch(
    src,
    /function maybeAppendStorySatisfactionCard\(\)[\s\S]*?appendSatisfactionCard/,
    'layout completion must not auto-open the chapter confirmation card',
  );
  assert.match(
    src,
    /yujee:authoring-pages-ready/,
    'draft page changes must notify the stable ChatPanel effect',
  );
  assert.match(
    src,
    /const onAuthoringPagesReady = \(\) => \{[\s\S]*?await loadStoryGate\(\);[\s\S]*?appendEditLoopReadyCard\(currentChapterId\);/,
    'pages-ready must refresh story-progress before opening the edit-loop prompt',
  );
});

test('a successful confirm advances the canvas and resets per-chapter chat history', () => {
  const fn = /async function applyEditChatProgressDecision\(prevChapterId: string\)[\s\S]*?\n {4}\}/.exec(src);
  assert.ok(fn, 'applyEditChatProgressDecision must exist');
  const body = fn![0];
  assert.match(body, /await loadStoryGate\(\)/, 'progressDecision handling must refresh the Web projection');
  // On advancement, clear the running chat log + awaiting flag, flip the book to the
  // new chapter, and append the next chapter card immediately. The chapter card must
  // not depend on the guide opener because the opener can legitimately bail on guards.
  assert.match(
    body,
    // Post-refactor the canvas flip is routed through the coordinator bridge
    // (co()?.goToChapterById?.(…)), so accept the optional-chained coordinator call.
    /const advanced = advancedTo != null && advancedTo !== prevChapterId;\s*if \(advanced\) \{[\s\S]*?chapterHistory\.length = 0;\s*awaitingSatisfaction = false;[\s\S]*?goToChapterById(?:\?\.)?\(advancedTo!\);[\s\S]*?appendChapterCard\(advancedTo!\);[\s\S]*?\}/,
    'advancing must reset state, flip the canvas, and append the next chapter card',
  );
  // Advancing to a new story chapter after layout should enter the edit-loop chat.
  // Only pre-layout chapters fall back to the interview opener.
  assert.match(
    body,
    /if \(advanced && storyGate\.stage !== 'theme'\) \{[\s\S]*?if \(currentChapterHasDraftPages\(\)\) \{[\s\S]*?appendEditLoopReadyCard\(advancedTo!\);[\s\S]*?\} else \{[\s\S]*?await runChapterGuideOpener\(\{ allowDuringSend: true \}\);/,
    'advancing after layout must open edit-loop chat; pre-layout advancement may still await the guide opener',
  );
  // Confirming the LAST chapter (stage → theme) still hands off to the theme step.
  assert.match(
    body,
    /if \(storyGate\.stage === 'theme'\) \{[\s\S]*?await runRecommendTheme\(undefined, \{ allowDuringSend: true \}\);/,
  );
});

test('runChapterGuideOpener can be explicitly chained from confirm while sending is locked', () => {
  const fn = /async function runChapterGuideOpener\([^)]*\)\s*\{[\s\S]*?\n {4}\}/.exec(src);
  assert.ok(fn, 'runChapterGuideOpener must exist');
  const body = fn![0];
  assert.match(
    fn![0],
    /async function runChapterGuideOpener\(opts\?: \{ allowDuringSend\?: boolean \}\)/,
    'opener must expose an explicit internal-send override',
  );
  assert.match(
    body,
    /if \(!isAuthoring \|\| \(!opts\?\.allowDuringSend && sending\) \|\| awaitingSatisfaction\) return;/,
    'only the explicit confirm-chain override may bypass the sending guard',
  );
});

test('goToChapterById maps a chapterId to its first page via the draft skeleton', () => {
  const fn = /function goToChapterById\(chapterId: string\) \{[\s\S]*?\n {4}\}/.exec(src);
  assert.ok(fn, 'goToChapterById must exist');
  const body = fn![0];
  assert.match(
    body,
    /draftSkel\?\.pages\.find\(\(p\) => p\.chapterId === chapterId\)\?\.pageIndex/,
    'chapter→page mapping must come from the draft skeleton (DraftSkeletonPage.chapterId)',
  );
  assert.match(body, /spreadIndexOfPage\(spreads, pageIdx\)/, 'must resolve the spread of that page');
  assert.match(body, /goToSpread\(sp\)/, 'must flip the book to that spread');
});
