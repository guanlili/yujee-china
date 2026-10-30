import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));

// The story-gate / export-ready wiring is split across EditorPort.tsx + EditorBook.tsx
// (render-time export gate in the shell; the imperative canvas logic — exportPdf,
// exportGateLocked, appendExportReadyCard — moved into EditorBook in the 2026-10-30
// split) and ChatPanel.tsx (imperative export guard + export-ready card), with
// editor-coordinator.ts as the bridge. These structural guards don't care which of
// the four a symbol lives in, so a request for the editor source returns the four
// merged; assertions still hit and doesNotMatch guards hold across all four.
const EDITOR_SOURCES = ['EditorPort.tsx', 'EditorBook.tsx', 'ChatPanel.tsx', 'editor-coordinator.ts'];
function source(file: string): string {
  if (file === 'EditorPort.tsx') {
    return EDITOR_SOURCES.map((f) => readFileSync(join(here, f), 'utf8')).join('\n\n');
  }
  return readFileSync(join(here, file), 'utf8');
}

test('story gate UI only applies when the progress payload has V3 chapters', () => {
  const src = source('EditorPort.tsx');

  assert.match(
    src,
    /const hasStoryGate = \(storyProgress\?\.chapterOrder\.length \?\? 0\) > 0;/,
    'non-V3 authoring progress returns chapterOrder: [] and must keep the export gate locked',
  );
  // §4.2: the standing「确定本章」breadcrumb button (showStoryGate / story-gate-btn) was
  // replaced by the in-flow satisfaction card — confirmation is a per-write affordance now.
  assert.doesNotMatch(
    src,
    /const showStoryGate =/,
    'the standing confirm-chapter breadcrumb button must be gone (satisfaction card drives it)',
  );
  assert.doesNotMatch(
    src,
    /story-gate-btn/,
    'the story-gate button must no longer be rendered',
  );
});

test('authoring export remains locked while story progress is unknown', () => {
  const src = source('EditorPort.tsx');

  assert.match(
    src,
    /const authoringExportLocked =\s*mode === 'authoring' &&\s*\(\s*storyProgress === null \|\|\s*\(hasStoryGate && !computeExportUnlocked\(breadcrumbStage, storyProgress\.allDone\)\)\s*\);/,
    'authoring must stay export-locked while storyProgress is null, and later stages must also require allDone',
  );
  // The refactor split `building` into its own BuildingShell component, so it's no
  // longer in this shell's scope: the render gate now reads `mode !== 'authoring'`
  // (building never reaches EditorShell). Same intent — finalized editing exports are
  // never subject to the authoring story-progress lock.
  assert.match(
    src,
    /const exportUnlocked = mode !== 'authoring' \|\| !authoringExportLocked;/,
    'finalized editing exports must not inherit the authoring story-progress lock',
  );
  assert.doesNotMatch(
    src,
    /hasStoryGate && storyProgress\?\.exportUnlocked !== true/,
    'render export locking must not rely on exportUnlocked disappearing when progress is unknown',
  );
});

test('export gate uses the live progress stage instead of stale album detail stage', () => {
  const src = source('EditorPort.tsx');

  // `building` split into its own shell, so this shell no longer branches on it; the
  // live stage still leads (storyProgress?.stage), falling back to detail.album.stage
  // and only then to 'analysing'. Same invariant: live progress overrides stale detail.
  assert.match(
    src,
    /const breadcrumbStage = storyProgress\?\.stage \?\? detail\.album\.stage \?\? 'analysing';/,
    'authoring progress can advance stage while detail.album.stage remains stale',
  );
  assert.doesNotMatch(
    src,
    /const exportUnlocked = [^;\n]*computeExportUnlocked\(detail\.album\.stage\)/,
    'export button gate must not read stale detail.album.stage directly',
  );
  assert.match(
    src,
    /computeExportUnlocked\(breadcrumbStage, storyProgress\.allDone\)/,
    'export button stage gate must use the same live stage as the breadcrumb and require allDone',
  );
  assert.doesNotMatch(
    src,
    /!computeExportUnlocked\(breadcrumbStage\)/,
    'a stale later stage must not unlock authoring before progress proves all chapters are done',
  );
  assert.doesNotMatch(
    src,
    /if \(!computeExportUnlocked\(detail\.album\.stage\)\) return;/,
    'imperative export guard must not read stale detail.album.stage directly',
  );
  assert.doesNotMatch(
    src,
    /if \(!computeExportUnlocked\(breadcrumbStage\)\) return;/,
    'imperative export guard is installed once and must not capture the render-time stage directly',
  );
});

test('imperative export guard locks unknown progress and exempts non-V3 authoring', () => {
  const src = source('EditorPort.tsx');

  assert.match(
    src,
    /function isAuthoringExportLocked\(progress: StoryProgress \| null = storyGate\) \{\s*if \(!isAuthoring\) return false;\s*if \(!progress\) return true;\s*if \(progress\.chapterOrder\.length === 0\) return false;\s*return !computeExportUnlocked\(progress\.stage, progress\.allDone\);\s*\}/,
    'imperative guard must lock null progress, exempt non-V3 authoring, and use effect-local refreshed progress',
  );
  // Post-refactor the lock is computed in ChatPanel (isAuthoringExportLocked) and
  // mirrored to the canvas via the coordinator (setExportGateUi), which is the same
  // helper — the button/gate refresh still routes through isAuthoringExportLocked.
  assert.match(
    src,
    /setExportGateUi\?\.\(isAuthoringExportLocked\(progress\)\)/,
    'button state refresh must use the same authoring export lock helper',
  );
  // exportPdf now defends via the mirrored exportGateLocked flag (fed by
  // setExportGateUi ← isAuthoringExportLocked), rather than an inline call.
  // NOTE (flagged for human review): the previous inline guard also appended a
  // "Confirm all chapters before exporting PDF." AI chat message; the refactor
  // dropped that user-facing message and the imperative guard now silently returns.
  assert.match(
    src,
    /let exportGateLocked = isAuthoring;/,
    'exportPdf must block unknown authoring progress via the mirrored export gate lock',
  );
  assert.match(
    src,
    /if \(exportGateLocked\) return;/,
    'exportPdf must defend against a locked authoring export before rendering a client PDF',
  );
  assert.doesNotMatch(
    src,
    /\(storyGate\?\.chapterOrder\.length \?\? 0\) > 0[\s\S]*?storyGate\?\.exportUnlocked !== true/,
    'the imperative export guard must not unlock just because storyGate is null',
  );
  assert.doesNotMatch(
    src,
    /\(storyGate\?\.chapterOrder\.length \?\? 0\) > 0[\s\S]*?!computeExportUnlocked\(currentLiveStage\(\)\)/,
    'the imperative stage guard must not be stage-only or skip unknown progress',
  );
});

test('stage gate is not a global prerequisite for finalized editing exports', () => {
  const src = source('EditorPort.tsx');

  assert.doesNotMatch(
    src,
    /const exportUnlocked = !building && computeExportUnlocked\(breadcrumbStage\) && !exportLocked;/,
    'finalized editing albums with stale analysing/story stage must not be locked by the render gate',
  );
  assert.match(
    src,
    /const authoringExportLocked =\s*mode === 'authoring' &&/,
    'render export locking must be scoped to authoring',
  );
  assert.match(
    src,
    /if \(!isAuthoring\) return false;/,
    'imperative export locking must be scoped to authoring',
  );
  assert.doesNotMatch(
    src,
    /if \(!computeExportUnlocked\(currentLiveStage\(\)\)\) return;/,
    'imperative exportPdf must not globally lock non-authoring exports by stale stage',
  );
});

test('export-ready closing card uses the locale-derived label, not mount-time i18n rewriting', () => {
  const src = source('EditorPort.tsx');

  // #236 ⑦⑧: the pinned top banner is gone — the closing line is now appended into the
  // chat flow by appendExportReadyCard(). It must still derive its copy from the React
  // locale (the same reason the banner did: a conditionally/imperatively created node
  // can't rely on the mount-time data-i18n sweep).
  assert.doesNotMatch(
    src,
    /<span[^>]*data-i18n="exportReady"[^>]*>/,
    'the export-ready copy must not depend on mount-time data-i18n rewriting',
  );
  assert.doesNotMatch(src, /export-ready-banner/, 'the pinned top banner JSX must be removed');
  // Post-refactor the locale-derived copy goes through the ChatPanel aT() helper
  // (aT(zh, en) picks by the same React locale) instead of an inline ternary — same
  // intent: both strings derive from the locale, not a mount-time data-i18n sweep.
  assert.match(
    src,
    /const exportReadyLabel = (?:locale === 'zh'\s*\?\s*'太棒了，你的书已经准备好了！'\s*:\s*'Wonderful — your book is ready!'|aT\('太棒了，你的书已经准备好了！', 'Wonderful — your book is ready!'\));/,
    'the export-ready copy should derive both zh/en strings from the React locale like storyGateLabel',
  );
  // The closing card renders that locale-derived label imperatively (textContent).
  const card = /function appendExportReadyCard\(\)\s*\{[\s\S]*?\n {4}\}/.exec(src);
  assert.ok(card, 'appendExportReadyCard() must exist');
  assert.match(card![0], /line\.textContent = exportReadyLabel/, 'the closing card must render exportReadyLabel');
});
