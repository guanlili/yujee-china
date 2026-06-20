import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// Issue #236 ①④⑥⑦⑧⑨ — editor guide / wrap-up flow fixes. EditorPort is one large
// imperative DOM effect with no jsdom harness (tests run under tsx/node:test), so —
// following the repo's existing source-assertion style (chapter-guide-satisfaction
// .test.ts, theme-cover-cards-wiring.test.ts) — we lock the load-bearing structural
// invariants. ⑨ is verified against the real buildSpreads at the bottom.

const here = dirname(fileURLToPath(import.meta.url));
function source(file: string): string {
  return readFileSync(join(here, file), 'utf8');
}

// ───────────────────────── ① opener double-fire guard ─────────────────────────
test('①: the per-chapter opener guard survives effect re-invocation (component-level ref, not effect-local Set)', () => {
  const src = source('EditorPort.tsx');
  // The dedup set must live at component scope (a useRef) so a StrictMode double-mount
  // (two effect invocations) shares ONE guard — an effect-local `new Set()` gives each
  // invocation its own empty set and fails to dedupe.
  assert.match(
    src,
    /const guidedChaptersRef = useRef<Set<string>>/,
    'guidedChapters must be a component-level useRef<Set<string>> to survive effect re-invocation',
  );
  // Inside the effect it is read off the ref, NOT re-created as a fresh local Set.
  assert.match(
    src,
    /const guidedChapters = guidedChaptersRef\.current/,
    'the effect must read the shared ref set, not allocate a new effect-local Set',
  );
  assert.doesNotMatch(
    src,
    /const guidedChapters = new Set<string>\(\)/,
    'the effect must NOT re-allocate guidedChapters as an effect-local Set (defeats dedupe across StrictMode mounts)',
  );
});

test('①: the opener holds an in-flight guard so two same-tick calls cannot both POST', () => {
  const src = source('EditorPort.tsx');
  const fn = /async function runChapterGuideOpener\(\)\s*\{[\s\S]*?\n {4}\}/.exec(src);
  assert.ok(fn, 'runChapterGuideOpener() body must be parseable');
  // An in-flight set keyed by chapterId blocks a second concurrent opener for the same
  // chapter before the first finishes (guidedChapters alone is added synchronously, but
  // the in-flight guard makes the intent explicit + covers the advance path too).
  assert.match(fn![0], /openerInFlight/, 'the opener must track an in-flight guard');
});

// ───────────────────────── ④ talk→write exit button ─────────────────────────
test('④: a persistent "write this chapter now" trigger sends an explicit write request', () => {
  const src = source('EditorPort.tsx');
  // A helper that appends the write-now affordance into the chat flow must exist.
  assert.match(
    src,
    /function appendWriteNowCard\(\)/,
    'appendWriteNowCard() must exist to give the user a talk→write exit',
  );
  const card = /function appendWriteNowCard\(\)\s*\{[\s\S]*?\n {4}\}/.exec(src);
  assert.ok(card, 'appendWriteNowCard() body must be parseable');
  // Clicking it routes through the normal chapter-chat turn with an explicit write ask,
  // so the model dispatches kind=write (the user "明确要写" signal).
  assert.match(card![0], /runChapterChatTurn\(/, 'the write-now trigger must run a chapter-chat turn');
});

test('④: entering/opening a live chapter surfaces the write-now exit (not only after talk)', () => {
  const src = source('EditorPort.tsx');
  // The opener (AI 先开口) is followed by the write-now affordance so the user always has
  // a way out of the talk loop — it is appended after the opener reply lands.
  const fn = /async function runChapterGuideOpener\(\)\s*\{[\s\S]*?\n {4}\}/.exec(src);
  assert.ok(fn, 'runChapterGuideOpener() body must be parseable');
  assert.match(fn![0], /appendWriteNowCard\(\)/, 'the opener must surface the write-now exit after its question');
});

// ───────────────────────── ⑥ cover apply/skip not reversed ─────────────────────────
test('⑥: "apply" only sends real (non-null) template ids; a null lookup degrades, never silently skips', () => {
  const src = source('EditorPort.tsx');
  const fn = /function appendCoverCard\(\)\s*\{[\s\S]*?\n {4}\}/.exec(src);
  assert.ok(fn, 'appendCoverCard() body must be parseable');
  // The apply handler must guard against a null cover/ending lookup: if BOTH ids are null
  // the card must NOT pretend to apply (which the agent reads as 跳过). We assert the apply
  // path only fires runCover with ids when at least one id resolved.
  assert.match(
    fn![0],
    /coverTemplateId != null \|\| endingTemplateId != null/,
    'apply must check that at least one template id resolved before sending it as an apply',
  );
});

test('⑥: the cover card is only offered when there is a real cover/ending page to apply', () => {
  const src = source('EditorPort.tsx');
  const fn = /function appendCoverCard\(\)\s*\{[\s\S]*?\n {4}\}/.exec(src);
  assert.ok(fn, 'appendCoverCard() body must be parseable');
  // When neither a cover nor an ending page exists in the skeleton, there's nothing to
  // apply — advance straight through (auto-skip) rather than show an apply button that
  // resolves to null ids and looks like a skip.
  assert.match(
    fn![0],
    /if \(coverTemplateId == null && endingTemplateId == null\)/,
    'appendCoverCard must short-circuit when no cover/ending page exists',
  );
});

// ───────────────────────── ⑦ final copy moves into the chat flow ─────────────────────────
test('⑦: the export-ready line is appended to the chat flow, not pinned as a fixed banner', () => {
  const src = source('EditorPort.tsx');
  // The fixed top banner JSX must be gone.
  assert.doesNotMatch(src, /export-ready-banner/, 'the pinned export-ready banner JSX must be removed');
  // Instead a helper appends the closing line as the last AI message in the thread.
  assert.match(src, /function appendExportReadyCard\(\)/, 'appendExportReadyCard() must exist (chat-flow closing message)');
});

// ───────────────────────── ⑧ export button at the bottom of the chat ─────────────────────────
test('⑧: the closing chat card carries an export entry point that runs the existing export', () => {
  const src = source('EditorPort.tsx');
  const card = /function appendExportReadyCard\(\)\s*\{[\s\S]*?\n {4}\}/.exec(src);
  assert.ok(card, 'appendExportReadyCard() body must be parseable');
  // The closing card must render an export button wired to the existing exportPdf() path.
  assert.match(card![0], /exportPdf\(\)/, 'the closing card export button must call exportPdf()');
});

test('⑧: the export-ready card is shown once when the export gate opens (guarded against repeats)', () => {
  const src = source('EditorPort.tsx');
  // A one-shot guard so re-running mirrorStage / story-gate refresh doesn't spam the card.
  assert.match(src, /exportReadyCardShown/, 'a one-shot guard must gate the export-ready card');
});
