import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// Issue #236 ①④⑥⑦⑧⑨ — editor guide / wrap-up flow fixes. EditorPort is one large
// imperative DOM effect with no jsdom harness (tests run under tsx/node:test), so —
// following the repo's existing source-assertion style (chapter-guide-satisfaction
// .test.ts, theme-cover-cards-wiring.test.ts) — we lock the load-bearing structural
// invariants for ①④⑥⑦⑧. ⑨ (cover/ending sit on solo pages) is untouched by this
// branch and its real behavior is verified in spreads.test.ts, not here.

const here = dirname(fileURLToPath(import.meta.url));
// Chat/interview logic moved out of EditorPort.tsx into ChatPanel.tsx and the
// canvas↔chat bridge editor-coordinator.ts. These structural guards don't care
// which of the three a symbol lives in, so a request for the editor source returns
// the three merged; assertions still hit and doesNotMatch guards hold across all three.
const EDITOR_SOURCES = ['EditorPort.tsx', 'ChatPanel.tsx', 'editor-coordinator.ts'];
function source(file: string): string {
  if (file === 'EditorPort.tsx') {
    return EDITOR_SOURCES.map((f) => readFileSync(join(here, f), 'utf8')).join('\n\n');
  }
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

test('①: the interview entry guards against re-entry while an interview is pending', () => {
  const src = source('EditorPort.tsx');
  const fn = /async function runChapterGuideOpener\([^)]*\)\s*\{[\s\S]*?\n {4}\}/.exec(src);
  assert.ok(fn, 'runChapterGuideOpener() body must be parseable');
  // 新流程:采访进行中(pendingInterview 已置)时,重复调用直接返回,避免同一 tick 双启采访。
  assert.match(fn![0], /if \(pendingInterview\) return/, 'the interview entry must bail while an interview is pending');
});

test('①: stale StrictMode interview effects cannot leave visible chat bound to a dead closure', () => {
  const src = source('ChatPanel.tsx');

  assert.match(src, /let disposed = false;/, 'the mount effect must own a disposed flag');
  assert.match(
    src,
    /async function typeInterviewMessages\([^)]*\): Promise<boolean> \{[\s\S]*?if \(disposed\) return false;[\s\S]*?return !disposed;/,
    'async interview typing must stop when its effect has been cleaned up',
  );
  assert.match(
    src,
    /if \(!\(await typeInterviewMessages\(messages\)\)\) return;/,
    'startChapterInterview must abort before appending controls from a stale effect',
  );
  assert.match(
    src,
    /return \(\) => \{[\s\S]*?disposed = true;[\s\S]*?shownChapterCardsRef\.current\.clear\(\);[\s\S]*?interviewChainStartedRef\.current = false;/,
    'cleanup must release StrictMode fake-mount claims so the live effect can own the interview',
  );
});

// ───────────────────────── ④ agent decides when to write (no write-now button) ─────────────────────────
// The old "write it now" chip existed because the system prompt forbade the model from
// writing unprompted (硬规则), stranding the user in a talk loop. That 红线 is gone: the
// agent now decides on its own when enough has been said and dispatches kind=write. The
// manual chip is fully removed — confirmation lives only in the post-write satisfaction card.
test('④: the manual write-now chip is fully removed (agent self-dispatches kind=write)', () => {
  const src = source('EditorPort.tsx');
  assert.doesNotMatch(
    src,
    /function appendWriteNowCard\b/,
    'appendWriteNowCard() must be removed — the agent decides when to write, no manual chip',
  );
  assert.doesNotMatch(
    src,
    /appendWriteNowCard\(\)/,
    'no call site may surface a write-now chip',
  );
  assert.doesNotMatch(
    src,
    /write-now-card/,
    'the write-now card markup must be gone',
  );
});

test('④: the satisfaction card opens only after a real chapter write, never on a talk turn', () => {
  const src = source('EditorPort.tsx');
  // 满意/想改 is a per-write affordance: it is gated on wroteChapter, so a talk turn (the
  // agent still gathering material) never shows it. This is the only standing confirmation.
  assert.match(
    src,
    /if \(wroteChapter && !res\.progressDecision\?\.chapterDone\)\s*\{\s*appendSatisfactionCard\(\);/,
    'appendSatisfactionCard() must be gated on wroteChapter (a fresh full-chapter write)',
  );
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
  // Post-refactor the chat panel reaches the canvas export via the coordinator bridge
  // (co()?.exportPdf?.()), so accept either the bare call or the coordinator-routed one.
  assert.match(card![0], /exportPdf(?:\?\.)?\(\)/, 'the closing card export button must call exportPdf()');
});

test('⑧: the export-ready card is shown once when the export gate opens (guarded against repeats)', () => {
  const src = source('EditorPort.tsx');
  // A one-shot guard so re-running mirrorStage / story-gate refresh doesn't spam the card.
  assert.match(src, /exportReadyCardShown/, 'a one-shot guard must gate the export-ready card');
});

// ───────── collect→layout remount: the canvas effect must reset collect-on ─────────
// collect-on 活在共享 outer root 上(跨 EditorBook remount 存活)。排版完成时画板以新 key
// (pages 0→N)重挂,新 effect 走版式分支画好了书;但若不摘掉收集态遗留的 collect-on,CSS
// 会继续藏住版式书 → 画板空白(排完版加载不出来的真凶)。锁住:每次挂载都在分支前无条件
// 复位这个类,收集态再由 renderCollectGrid 加回。
test('collect→layout remount authoritatively clears the stale collect-on class before painting', () => {
  const src = readFileSync(join(here, 'EditorPort.tsx'), 'utf8');
  // The unconditional reset must sit before the isCollectMode branch (renderCollectGrid re-adds it).
  assert.match(
    src,
    /bodyEl\.classList\.remove\('collect-on'\);\s*\n\s*if \(isCollectMode\) \{/,
    'the mount must remove collect-on before the isCollectMode branch so a layout remount unhides the book',
  );
});
