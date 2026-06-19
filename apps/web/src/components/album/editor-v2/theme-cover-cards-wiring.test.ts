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
//   • picking a palette fires apply-theme with the chosen theme + recommended chapterColors,
//   • there is NO "auto-apply the first candidate" fallback,
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

test('appendPaletteCard builds one .pc-group per theme option with the real swatch colors', () => {
  const fn = /function appendPaletteCard\(res: V3RecommendResponse\)[\s\S]*?\n {4}\}/.exec(src);
  assert.ok(fn, 'appendPaletteCard must exist');
  const body = fn![0];
  // One palette-card; one row per themeOption (the contract's ≤3 candidates).
  assert.match(body, /palette-card/);
  assert.match(body, /res\.themeOptions\.forEach/);
  // Swatches are the REAL recommended per-chapter accentColors (not unsplash/mock).
  assert.match(body, /res\.chapterColors/);
  assert.match(body, /c\.accentColor/);
  // First option carries the 推荐 badge; selected check on pick.
  assert.match(body, /pc-reco/);
  assert.match(body, /pc-check/);
});

test('picking a palette fires apply-theme with the chosen theme + recommended chapterColors', () => {
  const fn = /function appendPaletteCard\(res: V3RecommendResponse\)[\s\S]*?\n {4}\}/.exec(src);
  assert.ok(fn, 'appendPaletteCard must exist');
  const body = fn![0];
  assert.match(body, /runApplyTheme\(\{/);
  // The picked theme option (subject/label/tone) is sent as the chosen theme.
  assert.match(body, /theme: \{ subject: opt\.subject, label: opt\.label/);
  // The recommended per-chapter {accentColor, artFont} ride along as the chapter choices.
  assert.match(body, /chapters: res\.chapterColors\.map/);
  assert.match(body, /accentColor: c\.accentColor/);
  assert.match(body, /artFont: c\.artFont/);
});

test('runApplyTheme has NO auto-apply-first fallback (缺口#20: 删掉自动套第一兜底)', () => {
  // The whole effect must never silently default apply-theme to the first candidate.
  assert.doesNotMatch(src, /lastRecommend\?\.themeOptions\[0\]/);
  // runApplyTheme: with no user selection it surfaces the picker, applies nothing.
  assert.match(src, /async function runApplyTheme[\s\S]{0,400}if \(!theme \|\| !chapters \|\| chapters\.length === 0\)[\s\S]{0,160}await runRecommendTheme\(\)/);
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
  // 应用: re-run auto-fill on the current cover/ending templates.
  assert.match(body, /runCover\(\{ coverTemplateId, endingTemplateId \}\)/);
  // 跳过: empty selection → empty patch, never errors.
  assert.match(body, /runCover\(\{\}\)/);
});

test('skipCover action sends an empty cover selection (no auto design)', () => {
  assert.match(src, /skipCover: \(\) => \{ void runCover\(\{\}\); \}/);
});
