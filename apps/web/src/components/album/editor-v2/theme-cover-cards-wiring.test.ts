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
    /const applied = readDesignApplied\(m\.layoutPatch\);[\s\S]{0,300}buildCoverRecapCard\(applied\)[\s\S]{0,200}appendUserText\(c, \{ historyReplay: true \}\)/,
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
  // cover/ending resolved by skeleton kind (same as the live card), previewed read-only.
  assert.match(body, /kindByPageIndex\.get\(p\.pageIndex\) === 'cover'/);
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
