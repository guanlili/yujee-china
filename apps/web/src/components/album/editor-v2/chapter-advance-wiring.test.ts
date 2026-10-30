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
const src = ['EditorPort.tsx', 'EditorBook.tsx', 'ChatPanel.tsx', 'editor-coordinator.ts']
  .map((f) => readFileSync(join(here, f), 'utf8'))
  .join('\n\n');

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

test('layout-ready notifications refresh the authoring draft projection for the canvas', () => {
  assert.match(
    src,
    /async function loadDraftSkeleton\(\)[\s\S]*?fetchDraftSkeleton\(detail\.album\.id\)[\s\S]*?setSkeleton\(draft\)[\s\S]*?setLoadState\('ready'\)/,
    'EditorAuthoring must be able to refetch the draft projection after layout completes',
  );
  assert.match(
    src,
    /window\.addEventListener\('yujee:authoring-pages-ready', onAuthoringPagesReady\)/,
    'EditorAuthoring must listen for layout-ready notifications outside ChatPanel',
  );
  assert.match(
    src,
    /window\.dispatchEvent\(new CustomEvent\('yujee:authoring-pages-ready'\)\)/,
    'ChatPanel must notify the React authoring shell, not only its own DOM root',
  );
  assert.match(
    src,
    /<EditorBook[\s\S]*?key=\{`\$\{initialPages\.length\}:\$\{canvasEpoch \?\? 0\}`\}/,
    'refetched pages/text changes must remount EditorBook so collect mode and rendered copy are recomputed',
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
