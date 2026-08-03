import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const desktop = readFileSync(join(here, 'editor-port.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const desktopComponent = readFileSync(join(here, 'EditorPort.tsx'), 'utf8');
const mobile = readFileSync(join(here, 'mobile/mobile-editor.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 's').exec(css);
  assert.ok(match, `missing CSS rule: ${selector}`);
  return match[1];
}

test('desktop paired spread has a responsive fold band, center seam, and side curvature', () => {
  assert.match(desktop, /\.editor-port \.book::before\{[^}]*width:\s*clamp\(/s);
  assert.match(desktop, /\.editor-port \.book::after\{[^}]*left:\s*50%[^}]*pointer-events:\s*none/s);
  assert.match(desktop, /\.editor-port \.book:not\(\.book-solo\):not\(\.book-full\) \.page-left::before/s);
  assert.match(desktop, /\.editor-port \.book:not\(\.book-solo\):not\(\.book-full\) \.page-right::before/s);
});

test('desktop real pages keep a base paper edge below the selected-page border', () => {
  const edge = ruleBody(desktop, '.editor-port .page::after');
  const selected = ruleBody(desktop, '.editor-port .page.page-selected::after');
  const edgeLayer = Number(/\bz-index:\s*(\d+)/.exec(edge)?.[1]);
  const selectedLayer = Number(/\bz-index:\s*(\d+)/.exec(selected)?.[1]);

  assert.match(edge, /pointer-events:\s*none/);
  assert.match(edge, /box-shadow:[^;]*rgba\(255,\s*255,\s*255,[^)]+\)[^;]*rgba\(24,\s*28,\s*27,[^)]+\)/s);
  assert.ok(selectedLayer > edgeLayer, 'selected-page border must stay above the base paper edge');
});

test('desktop empty pages suppress the base paper edge', () => {
  assert.match(
    ruleBody(desktop, '.editor-port .page.page-empty::after'),
    /display:\s*none/,
    'an empty page must not render the base paper edge',
  );
});

test('desktop fold is absent on solo but PRESENT on double-wide (bound halves)', () => {
  assert.match(desktop, /\.editor-port \.book\.book-solo::before[^}]*display:\s*none/s);
  assert.match(desktop, /\.editor-port \.book\.book-solo::after[^}]*display:\s*none/s);
  // 双宽(#303)页 2026-08-02 起保留书脊沟槽与接缝:它是装订的两半,与四端一致。
  assert.doesNotMatch(desktop, /\.editor-port \.book\.book-full::before[^}]*display:\s*none/s);
  assert.doesNotMatch(desktop, /\.editor-port \.book\.book-full::after[^}]*display:\s*none/s);
});

test('desktop 3D book avoids isolation that flattens turning leaves', () => {
  assert.doesNotMatch(ruleBody(desktop, '.editor-port .book'), /\bisolation\s*:\s*isolate\b/);
});

test('desktop 3D book JSX avoids grouping overflow utilities that flatten turning leaves', () => {
  const bookClasses = /<div className="([^"]*\bbook\b[^"]*)" id="book">/.exec(desktopComponent)?.[1];
  assert.ok(bookClasses, 'missing the real desktop #book JSX class list');
  assert.doesNotMatch(
    bookClasses,
    /\boverflow(?:-[xy])?-(?:hidden|auto|scroll)\b/,
    'the preserve-3d book must leave clipping to terminal page and leaf faces',
  );
});

test('desktop 3D flipper avoids filters that flatten its leaf faces', () => {
  assert.doesNotMatch(ruleBody(desktop, '.editor-port .flipper'), /(?:^|;)\s*filter\s*:/);
});

test('desktop terminal leaf faces preserve a moving-paper shadow', () => {
  assert.match(ruleBody(desktop, '.editor-port .leaf'), /(?:^|;)\s*box-shadow\s*:/);
});

test('desktop turning leaf stays above the spine, carries paper lighting, and keeps empty leaves clear', () => {
  assert.match(desktop, /\.editor-port \.flipper\{[^}]*z-index:\s*6/s);
  assert.match(desktop, /\.editor-port \.leaf::before\{[^}]*pointer-events:\s*none/s);
  assert.match(desktop, /\.editor-port \.leaf\.leaf-empty::before\{[^}]*display:\s*none/s);
});

test('mobile paired spread has a responsive fold, seam, and side curvature', () => {
  assert.match(mobile, /\.mobile-editor \.mspread\[data-paper-spine='1'\]::before\{[^}]*width:\s*clamp\(/s);
  assert.match(mobile, /\.mobile-editor \.mspread\[data-paper-spine='1'\]::after\{[^}]*left:\s*50%[^}]*pointer-events:\s*none/s);
  assert.match(mobile, /\.mobile-editor \.mspread\[data-paper-spine='1'\] \.mpage:first-of-type::before/s);
  assert.match(mobile, /\.mobile-editor \.mspread\[data-paper-spine='1'\] \.mpage:nth-of-type\(2\)::before/s);
});

test('mobile exposes a spine only when both rendered halves contain real pages', () => {
  const component = readFileSync(join(here, 'mobile/MobileEditor.tsx'), 'utf8');
  assert.match(
    component,
    /data-paper-spine=\{faces\.length === 2 && faces\.every\(\(pageIndex\) => pageIndex != null\) \? '1' : undefined\}/,
  );
});

test('mobile 3D spread avoids isolation that flattens turning leaves', () => {
  assert.doesNotMatch(ruleBody(mobile, '.mobile-editor .mspread'), /\bisolation\s*:\s*isolate\b/);
});

test('mobile 3D leaf avoids filters that flatten its two faces', () => {
  assert.doesNotMatch(ruleBody(mobile, '.mobile-editor .mleaf'), /(?:^|;)\s*filter\s*:/);
});

test('mobile terminal leaf faces preserve a moving-paper shadow', () => {
  assert.match(ruleBody(mobile, '.mobile-editor .mleaf-face'), /(?:^|;)\s*box-shadow\s*:/);
});

test('mobile moving leaf stays above the fold and carries two-sided lighting', () => {
  assert.match(mobile, /\.mobile-editor \.mleaf\{[^}]*z-index:\s*6/s);
  assert.match(mobile, /\.mobile-editor \.mleaf-face::after\{[^}]*pointer-events:\s*none/s);
  assert.match(mobile, /\.mobile-editor \.mleaf-back::after/s);
});

// ── 书口纸张堆叠(页缘)+ 书体投影 ─────────────────────────────────────────
// 摊开的书(双页 pair / 双宽 full)在书体两侧叠出错位纸边:x 偏移 + 负 spread 的
// box-shadow,越深的纸越短。与分享页 FlipBook 的 PaperEdges 同一意图,三个渲染面
// (桌面编辑器 / 移动编辑器 / 分享页)必须是同一本书。

test('desktop open book (pair + double-wide) carries the stacked paper edges over the depth shadows', () => {
  const rule =
    /\.editor-port \.book\.book-full,\s*\n\.editor-port \.book:not\(\.book-solo\):not\(\.book-full\):not\(:has\(\.page-empty\)\)\{([^}]*)\}/s.exec(
      desktop,
    );
  assert.ok(rule, 'missing the paper-edge stack rule for open desktop books');
  const body = rule![1]!;
  // 两侧纸线(负 x 与正 x 各一组)+ 越深越短(负 spread 递增)。纸色走 token
  // (--paper-sheet-*),移动端的「不自造颜色」护栏对两棵树都成立。
  assert.match(body, /-2px 0 0 -1px var\(--paper-sheet-lit\)/);
  assert.match(body, /(?<!-)2px 0 0 -1px var\(--paper-sheet-lit\)/);
  assert.match(body, /-8px 0 0 -3px/);
  // box-shadow 整组覆盖 —— 三层书体投影必须在这条规则里重复,否则纸叠会吃掉投影。
  assert.match(body, /0 1px 2px rgba\(20,24,23,\.16\)/);
  assert.match(body, /0 28px 58px rgba\(20,24,23,\.10\)/);
});

test('desktop solo (closed cover/ending) keeps the plain depth shadow — no double-sided paper stack', () => {
  // solo 不在纸叠选择器里:哪一侧开口取决于封面还是封尾,CSS 辨不出。
  assert.doesNotMatch(
    desktop,
    /\.editor-port \.book\.book-solo[^{]*\{[^}]*--paper-sheet/s,
    'a solo book must not opt into the paper stack',
  );
  assert.match(ruleBody(desktop, '.editor-port .book'), /0 28px 58px rgba\(20,24,23,\.10\)/);
});

test('mobile open book (pair + double-wide) carries paper edges + deepened shadows, off during edge motion', () => {
  const rule =
    /\.mobile-editor \.mspread\[data-paper-spine='1'\]:not\(\[data-edge-motion='1'\]\),\s*\n\.mobile-editor \.mspread\[data-kind='full'\]:not\(\[data-edge-motion='1'\]\):not\(\[data-resting-solo='1'\]\)\{([^}]*)\}/s.exec(
      mobile,
    );
  assert.ok(rule, 'missing the mobile paper-edge stack rule (pair via paper-spine, double-wide via data-kind)');
  const body = rule![1]!;
  assert.match(body, /-8px 0 0 -3px var\(--paper-sheet-lit\)/);
  assert.match(body, /0 34px 70px rgba\(20,24,23,\.16\)/, 'the open book must deepen its shadow over photo board backgrounds');
});

test('mobile spread renders data-kind so CSS can key the double-wide book body', () => {
  const component = readFileSync(join(here, 'mobile/MobileEditor.tsx'), 'utf8');
  assert.match(component, /data-kind=\{kind\}/);
});
