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
// The theme/cover-card wiring moved out of EditorPort.tsx into ChatPanel.tsx
// (dialogue) and editor-coordinator.ts (the canvas↔chat bridge). These structural
// guards don't care which of the three a symbol lives in, so `src` is the three
// merged; the doesNotMatch guards still hold across all three.
const src = ['EditorPort.tsx', 'ChatPanel.tsx', 'editor-coordinator.ts']
  .map((f) => readFileSync(join(here, f), 'utf8'))
  .join('\n\n');

// ─── restore chat decision cards on reload ──────────────────────────────────
// The theme/cover cards are session-only DOM (album_messages is text-only), so on
// re-entry they're re-derived from stage + draftSkel: past stages as read-only
// recaps, the current stage as its live actionable card. Without this, refreshing
// mid-theme/mid-cover left no card to continue with.

// ─── in-place cover recap replay (designApplied marker) ─────────────────────
// applyDesign persists the selection as a user message with layoutPatch.designApplied;
// loadHistory rebuilds the read-only recap card AT ITS RECORDED POSITION (before the
// user bubble), so refreshing no longer teleports the recap to the bottom of the chat.

test('loadHistory rebuilds the cover recap in place from the designApplied marker', () => {
  // reader validates the marker shape and bails to null on junk.
  assert.match(src, /function readDesignApplied\(layoutPatch: unknown\)/);
  // user branch: marker → recap card (history-replay tagged) appended BEFORE the bubble.
  assert.match(
    src,
    /const applied = readDesignApplied\(m\.layoutPatch\);[\s\S]{0,900}buildCoverRecapCard\([\s\S]{0,300}appendUserText\(c, \{ historyReplay: true \}\)/,
  );
  // the flag is reset on每次 replay 清场 so a re-run can't leak a stale true.
  assert.match(src, /data-history-replay[\s\S]{0,120}historyHadCoverRecap = false;/);
});

test('appendCoverSummary is a READ-ONLY recap (preview only, no API call)', () => {
  const fn = /function appendCoverSummary\(\)[\s\S]*?\n {4}\}/.exec(src);
  assert.ok(fn, 'appendCoverSummary must exist');
  const body = fn![0];
  // 2026-07 重构:回执统一走 buildCoverRecapCard(chap-card 体系,封面+封底成对小预览)。
  assert.match(body, /buildCoverRecapCard\(/);
  // cover/ending 的解析(按骨架 kind 取真页)统一收进 coverRecapFromPages —— 三条
  // 回执路径(实时成稿后/历史回放/ready 兜底)共用同一份,不再各写各的。
  assert.match(body, /coverRecapFromPages\(recapSourcePages\(\)\)/);
  // read-only: never posts a cover selection.
  assert.doesNotMatch(body, /runCover\(/);
  assert.doesNotMatch(body, /runApplyDesign/);

  // 回执卡构建器:只读(is-recap),封面/封底经 coordinator 桥渲染,无任何交互监听。
  const builder = /function buildCoverRecapCard\([\s\S]*?return card;\n {4}\}/.exec(src);
  assert.ok(builder, 'buildCoverRecapCard must exist');
  assert.match(builder![0], /cv-opt is-recap/);
  assert.match(builder![0], /coverOptionHTML\?\.\(set\.coverTemplateId/);
  assert.match(builder![0], /coverOptionHTML\?\.\(set\.endingTemplateId/);
  assert.doesNotMatch(builder![0], /addEventListener/);
});

test('回执卡的真文案来自真页面:recapSourcePages 带 textsJson,三条路都经 coverRecapFromPages', () => {
  const src2 = /function recapSourcePages\(\)[\s\S]*?\n {4}\}/.exec(src);
  assert.ok(src2, 'recapSourcePages must exist');
  assert.match(src2![0], /textsJson:\s*p\.textsJson/, '真页文案要带进回执数据');
  assert.match(src2![0], /htmlJson/, '页根底色从 html 读,必须带上');
  // 历史回放这条路也要用真页面(此前只按 designApplied 标记重建,永远渲模板 sample,
  // 而且 pageBackground 整个漏掉 —— buildCoverRecapCard 只传了一个参数)。
  const replay = /const applied = readDesignApplied\(m\.layoutPatch\);[\s\S]*?appendUserText\(c, \{ historyReplay: true \}\)/.exec(src);
  assert.ok(replay, 'loadHistory 的 designApplied 分支必须可解析');
  assert.match(replay![0], /coverRecapFromPages\(recapSourcePages\(\)\)/, '有真页时用真页');
  assert.match(replay![0], /coverPreviewBackground\(applied\)/, '没真页时也要按标记算出底色');
});

// ─── 成稿完成后回执卡换成真文案(评审 F2) ───────────────────────────────────
// 用户真正走的那条路是 runApplyDesign → waitForComposeThenRefresh:选定时建的那张
// 回执卡没有文案(那时 compose 还没跑),渲的是模板 sample。成书后必须原位换掉。

test('waitForComposeThenRefresh 用成书后的真页面原位替换回执卡', () => {
  const fn = /async function waitForComposeThenRefresh\([\s\S]*?\n {4}\}/.exec(src);
  assert.ok(fn, 'waitForComposeThenRefresh must exist');
  const body = fn![0];
  // 传进来的 recap 元素此前完全没被用过(死参数),现在必须真的被替换掉。
  assert.match(body, /recap\?\.isConnected/, '回执卡还在 DOM 里才换');
  assert.match(
    body,
    /coverRecapFromPages\(draft\.pages\)[\s\S]{0,200}recap\.replaceWith\(buildCoverRecapCard\(live, live\.pageBackground\)\)/,
    '用刚取到的骨架真页(带 textsJson)重建回执卡并原位替换',
  );
});

// ─── 第三套配色:系统派定,不再让用户挑(产品决定 2026-08) ────────────────────
// Task 12 那排色点已拆除:buildCoverSets 按 albumId 确定性派一个 coverColorway,
// 前端只负责原样透传。请求体仍逐字段列(不能 ...set:route 是 .strict())。

test('选择卡不再有配色色点,第三套的配色随这一套一起确认', () => {
  const fn = /async function offerDesignCard\(\)[\s\S]*?\n {4}\}/.exec(src);
  assert.ok(fn, 'offerDesignCard must exist');
  assert.doesNotMatch(fn![0], /cv-swatch/, '色点 UI 已拆除');
  assert.doesNotMatch(src, /selectedColorway/, '没有「用户选的配色」这个状态了');
  assert.match(
    src,
    /runApplyDesign\(sets\[selected\], sets\[selected\]\?\.pageBackground, sets\[selected\]\?\.coverColorway\)/,
    '确认时把服务端派定的配色 id 原样送出',
  );
});

test('第三套的预览用它的 colorway 底色渲染,不是那套的书页底色', () => {
  const fn = /async function offerDesignCard\(\)[\s\S]*?\n {4}\}/.exec(src);
  assert.ok(fn, 'offerDesignCard must exist');
  assert.match(fn![0], /const previewBg = coverPreviewBackground\(set\)/);
  assert.match(fn![0], /coverOptionHTML\?\.\(set\.coverTemplateId, set\.coverPhotoId, 46, 60, previewBg\)/);
  assert.match(fn![0], /coverOptionHTML\?\.\(set\.endingTemplateId, set\.endingPhotoId, 46, 60, previewBg\)/);
  assert.doesNotMatch(fn![0], /46, 60, set\.pageBackground/, '不能再把近白内页底色盖到深色封面上');
});

test('POST /design 的请求体仍是逐字段列举(不能 ...set 展开)', () => {
  const run = /async function runApplyDesign\([\s\S]*?\n {4}\}/.exec(src);
  assert.ok(run, 'runApplyDesign must exist');
  assert.doesNotMatch(run![0], /\.\.\.set\b/, 'route 的 BodySchema 是 .strict(),展开会 400');
  assert.match(run![0], /coverTemplateId: set\.coverTemplateId/);
  assert.match(run![0], /\.\.\.\(coverColorway \? \{ coverColorway \} : \{\}\)/);
});
