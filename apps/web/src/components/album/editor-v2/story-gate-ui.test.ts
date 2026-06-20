import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));

function source(file: string): string {
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
  assert.match(
    src,
    /const exportUnlocked = !building && !authoringExportLocked;/,
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

  assert.match(
    src,
    /const breadcrumbStage = building \? 'analysing' : storyProgress\?\.stage \?\? detail\.album\.stage;/,
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
  assert.match(
    src,
    /const locked = isAuthoringExportLocked\(progress\);/,
    'button state refresh must use the same authoring export lock helper',
  );
  assert.match(
    src,
    /if \(isAuthoringExportLocked\(\)\) \{[\s\S]*?Confirm all chapters before exporting PDF\./,
    'exportPdf must block null/unknown authoring progress before rendering a client PDF',
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

test('export ready banner renders locale text directly when it mounts after i18n setup', () => {
  const src = source('EditorPort.tsx');

  assert.doesNotMatch(
    src,
    /<span[^>]*data-i18n="exportReady"[^>]*>/,
    'the conditionally mounted export-ready banner must not depend on mount-time data-i18n rewriting',
  );
  assert.match(
    src,
    /const exportReadyLabel = locale === 'zh'\s*\?\s*'太棒了，你的书已经准备好了！'\s*:\s*'Wonderful — your book is ready!';/,
    'the export-ready banner should derive both zh/en strings from the React locale like storyGateLabel',
  );
  assert.match(
    src,
    /<span>\{exportReadyLabel\}<\/span>/,
    'the export-ready banner should render the locale-derived label in JSX',
  );
});
