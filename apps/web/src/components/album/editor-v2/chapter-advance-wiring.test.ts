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
const src = readFileSync(join(here, 'EditorPort.tsx'), 'utf8');

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

test('a successful confirm advances the canvas and resets per-chapter chat history', () => {
  const fn = /async function applyEditChatProgressDecision\(prevChapterId: string\)[\s\S]*?\n {4}\}/.exec(src);
  assert.ok(fn, 'applyEditChatProgressDecision must exist');
  const body = fn![0];
  assert.match(body, /await loadStoryGate\(\)/, 'progressDecision handling must refresh the Web projection');
  // On advancement, clear the running chat log + awaiting flag and flip the book to the
  // new chapter. (§4.2: the new chapter then auto-opens with a guide turn.)
  assert.match(
    body,
    /const advanced = advancedTo != null && advancedTo !== prevChapterId;\s*if \(advanced\) \{[\s\S]*?chapterHistory\.length = 0;\s*awaitingSatisfaction = false;[\s\S]*?goToChapterById\(advancedTo!\);\s*\}/,
    'advancing must reset chapterHistory + awaitingSatisfaction and flip the canvas to the new chapter',
  );
  // Advancing to a new STORY chapter auto-fires the guide opener (引导优先).
  assert.match(
    body,
    /if \(advanced && storyGate\.stage !== 'theme'\) \{\s*void runChapterGuideOpener\(\)/,
    'advancing to the next story chapter must auto-fire the guide opener',
  );
  // Confirming the LAST chapter (stage → theme) still hands off to the theme step.
  assert.match(body, /if \(storyGate\.stage === 'theme'\) \{[\s\S]*?await runRecommendTheme\(\);/);
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
