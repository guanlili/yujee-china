import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// 缺口#20 source-assertion guards for the ③ palette-card + ④ cover-card wiring inside
// EditorPort.tsx. EditorPort is one imperative DOM effect with no jsdom harness (tests
// run under `tsx --test`); the pure logic it calls (postRecommend/postApplyTheme/postCover,
// applyPatchToPages, album-service slice/stage) is covered in its own unit tests. Here we
// lock the load-bearing wiring invariants of the theme/cover selector UI:
//   • recommend renders the palette-card from the REAL contract response,
//   • the palette-card lists one row per theme option, apply-theme expands the selected
//     option into per-chapter {subject, accentColor, artFont},
//   • there is NO "auto-apply" fallback,
//   • confirming the last chapter (stage → theme) surfaces the palette-card,
//   • apply-theme advancing (stage → cover) surfaces the cover-card,
//   • the cover-card 应用 sends template ids and 跳过 sends an empty selection.

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, 'EditorPort.tsx'), 'utf8');

test('runRecommendTheme renders the palette-card after the reply', () => {
  const fn = /async function runRecommendTheme\([\s\S]*?\n {4}\}/.exec(src);
  assert.ok(fn, 'runRecommendTheme must exist');
  const body = fn![0];
  assert.match(body, /postRecommend\(albumId/);
  assert.match(body, /appendPaletteCard\(res\)/);
});

test('appendPaletteCard builds one row per book theme option', () => {
  const fn = /function appendPaletteCard\(res: V3RecommendResponse\)[\s\S]*?\n {4}\}/.exec(src);
  assert.ok(fn, 'appendPaletteCard must exist');
  const body = fn![0];
  // One palette-card; one row per book theme option.
  assert.match(body, /palette-card/);
  assert.match(body, /res\.bookThemeOptions\.forEach/);
  assert.match(body, /option\.label/);
  assert.match(body, /option\.style/);
  assert.match(body, /option\.chapters\.slice\(0, 4\)/);
  assert.match(body, /pc-apply/);
});

test('each 应用 action expands selected option to per-chapter choices', () => {
  const fn = /function appendPaletteCard\(res: V3RecommendResponse\)[\s\S]*?\n {4}\}/.exec(src);
  assert.ok(fn, 'appendPaletteCard must exist');
  const body = fn![0];
  assert.match(body, /runApplyTheme\(\{/);
  assert.match(body, /chapters: option\.chapters\.map/);
  assert.match(body, /subject: c\.subject/);
  assert.match(body, /accentColor: c\.accentColor/);
  assert.match(body, /artFont: option\.artFont/);
  assert.doesNotMatch(body, /Untitled Chapter/);
  assert.doesNotMatch(body, /未命名章节/);
});

test('runApplyTheme has NO auto-apply fallback (缺口#20: 删掉自动套兜底)', () => {
  // The whole effect must never silently default apply-theme to a candidate.
  assert.doesNotMatch(src, /lastRecommend\?\.themeOptions/);
  // runApplyTheme: with no user selection it surfaces the picker, applies nothing.
  assert.match(src, /async function runApplyTheme[\s\S]{0,400}if \(!chapters \|\| chapters\.length === 0\)[\s\S]{0,160}await runRecommendTheme\(\)/);
});

test('confirming the last chapter (stage → theme) surfaces the palette-card', () => {
  // markCurrentChapterDone reads the returned stage; when it advances to 'theme'
  // it kicks off the recommend → palette-card flow.
  assert.match(src, /if \(storyGate\.stage === 'theme'\)\s*\{[\s\S]{0,160}runRecommendTheme\(\)/);
});

test('apply-theme advancing (stage → cover) surfaces the cover-card', () => {
  assert.match(src, /if \(res\.stage === 'cover'\)[\s\S]{0,160}appendCoverCard\(\)/);
});

test('cover-card 应用 sends current template ids; 跳过 sends an empty selection (§4.4)', () => {
  const fn = /function appendCoverCard\(\)[\s\S]*?\n {4}\}/.exec(src);
  assert.ok(fn, 'appendCoverCard must exist');
  const body = fn![0];
  assert.match(body, /cover-card/);
  // 封面/封底 resolved from the read-only draft skeleton kinds, not mock images.
  assert.match(body, /kindByPageIndex\.get\(p\.pageIndex\) === 'cover'/);
  assert.match(body, /kindByPageIndex\.get\(p\.pageIndex\) === 'ending'/);
  // 应用 (#236 ⑥): re-run auto-fill on the current cover/ending templates, but forward ONLY
  // the ids that actually resolved — a null id reads as 跳过 agent-side, so a null lookup
  // must never be sent as an "apply" (that was the "应用→已跳过" bug). The apply path spreads
  // the non-null ids conditionally.
  assert.match(body, /coverTemplateId != null \? \{ coverTemplateId \} : \{\}/);
  assert.match(body, /endingTemplateId != null \? \{ endingTemplateId \} : \{\}/);
  // 跳过: empty selection → empty patch, never errors.
  assert.match(body, /runCover\(\{\}\)/);
});

test('skipCover action sends an empty cover selection (no auto design)', () => {
  assert.match(src, /skipCover: \(\) => \{ void runCover\(\{\}\); \}/);
});

test('cover-stage free text routes to the cover turn with cover history', () => {
  const fn = /async function send\(\)[\s\S]*?\n {4}\}/.exec(src);
  assert.ok(fn, 'send must exist');
  const body = fn![0];
  assert.match(body, /storyGate\?\.stage === 'cover'/);
  assert.match(body, /runCover\(\{[\s\S]{0,180}userMessage: txt[\s\S]{0,180}history: coverHistory\.slice\(-CHAT_HISTORY_MAX\)/);
  assert.match(body, /return/);
});

// ─── restore chat decision cards on reload ──────────────────────────────────
// The theme/cover cards are session-only DOM (album_messages is text-only), so on
// re-entry they're re-derived from stage + draftSkel: past stages as read-only
// recaps, the current stage as its live actionable card. Without this, refreshing
// mid-theme/mid-cover left no card to continue with.

test('on re-entry, the active decision card is re-emitted per stage', () => {
  // theme → live palette card; cover → theme recap + live cover card; ready → both recaps.
  assert.match(src, /else if \(stage === 'theme' \|\| stage === 'cover' \|\| stage === 'ready'\)/);
  assert.match(src, /if \(stage === 'theme'\)\s*\{\s*void runRecommendTheme\(\)/);
  // cover stage: theme recap + live cover card (the cover branch carries a multi-line
  // legacy-auto-advance note between the calls, so the window is generous).
  assert.match(src, /else if \(stage === 'cover'\)\s*\{[\s\S]{0,400}appendThemeSummary\(\);[\s\S]{0,400}appendCoverCard\(\)/);
  // ready branch (the trailing else): both stages walked past → both read-only recaps.
  assert.match(src, /appendThemeSummary\(\);[\s\S]{0,400}appendCoverSummary\(\)/);
});

test('appendThemeSummary is a READ-ONLY recap of chapter titles (no apply action)', () => {
  const fn = /function appendThemeSummary\(\)[\s\S]*?\n {4}\}/.exec(src);
  assert.ok(fn, 'appendThemeSummary must exist');
  const body = fn![0];
  assert.match(body, /palette-card is-recap/);
  assert.match(body, /draftSkel\?\.chapters/);
  // shows each chapter's applied title (subject), falling back to its label.
  assert.match(body, /c\.subject && c\.subject\.trim\(\)\) \|\| c\.label/);
  // read-only: no apply button, never re-fires apply-theme.
  assert.doesNotMatch(body, /pc-apply/);
  assert.doesNotMatch(body, /runApplyTheme/);
});

test('appendCoverSummary is a READ-ONLY recap (preview or 跳过, no API call)', () => {
  const fn = /function appendCoverSummary\(\)[\s\S]*?\n {4}\}/.exec(src);
  assert.ok(fn, 'appendCoverSummary must exist');
  const body = fn![0];
  assert.match(body, /cover-card is-recap/);
  // cover/ending resolved by skeleton kind (same as the live card), previewed read-only.
  assert.match(body, /kindByPageIndex\.get\(p\.pageIndex\) === 'cover'/);
  assert.match(body, /coverOptionHTML\(page\.templateId/);
  // 已跳过 when neither cover nor ending page exists.
  assert.match(body, /已跳过封面设计/);
  // read-only: never posts a cover selection.
  assert.doesNotMatch(body, /runCover/);
});
