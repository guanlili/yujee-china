import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const CSS = readFileSync(new URL('./editor-port.css', import.meta.url), 'utf8');
const PORT = readFileSync(new URL('./EditorPort.tsx', import.meta.url), 'utf8') + '\n\n' + readFileSync(new URL('./EditorBook.tsx', import.meta.url), 'utf8');

// 双宽页占满整个跨页:右 cell 退场(左 cell flex:1 自动撑满)。
// 中缝 2026-08-02 起**保留**:双宽页是装订的两半,书沟与四端一致(反转旧决定)。
test('book-full collapses the empty half but keeps the spine', () => {
  assert.match(CSS, /\.book\.book-full\s*\.page\.page-empty\s*\{[^}]*display:\s*none/);
  assert.doesNotMatch(CSS, /\.book\.book-full::before\s*\{[^}]*display:\s*none/, '双宽页的书脊沟槽不许再隐藏');
  assert.doesNotMatch(CSS, /\.book\.book-full::after\s*\{[^}]*display:\s*none/, '双宽页的 1px 接缝不许再隐藏');
});

test('paintSpread toggles book-full from Spread.full', () => {
  assert.match(PORT, /classList\.toggle\(\s*'book-full'\s*,\s*(?:fullIdx\s*!=\s*null|spreads\[i\]\?\.full\s*!=\s*null)\s*\)/);
});

// A full spread is ONE double-wide face — there is no meaningful way to split it into a
// leaf half + facing cell for the flip animation. Without this guard, flipping onto or off
// of a full-spread page would build the leaf from two nulls and paint blank leaves. So
// flipTo must direct-switch (no leaf animation) whenever either endpoint is a full spread.
//
// #303 收紧:Spread 现在是判别式联合(kind: 'pair' | 'full'),旧写法 `spreads[i]?.full`
// 已不存在;这里同时 pin 住「守卫存在」和「守卫在拆左右半页之前」—— 顺序反了,
// 拆解会先跑,守卫就白设了。
test('flipTo direct-switches when either endpoint is a full (double-wide) spread', () => {
  const flip = /function flipTo\([^]*?\n    \}/.exec(PORT);
  assert.ok(flip, 'expected to locate the flipTo function body');
  const body = flip![0];
  assert.match(
    body,
    /if \(curFaces\.kind === 'full' \|\| nxtFaces\.kind === 'full'\)/,
    'flipTo must skip the leaf animation when either the current or target spread is a full-spread page',
  );
  const guardAt = body.indexOf("curFaces.kind === 'full'");
  const splitAt = body.indexOf('const { left: curLeft');
  assert.ok(splitAt > guardAt && guardAt >= 0, 'the full-spread guard must run BEFORE the left/right split');
});

// ── #303 I4:画板总览网格。in-file 注释把它称作「全保真模式…总览网格就是主画板」,
// 它是主编辑表面而非缩略图。它过去也只读 spreadPages() → 双宽页画成一个空跨页。
// 修法与书籍视图的 book-full 完全同构:整张画进左 cell,右 cell 退场,中缝隐藏。

test('overview grid gives a full spread its own ov-full branch (one face, no spine)', () => {
  const render = /function renderOverview\(\)[^]*?\n    \}/.exec(PORT);
  assert.ok(render, 'expected to locate renderOverview');
  const body = render![0];
  assert.match(body, /const full = faces\.kind === 'full'/, '总览必须先判双宽,再谈左右半页');
  assert.match(
    body,
    /const \[lp, rp\] = full \? \[faces\.page, null\] : \[faces\.left, faces\.right\]/,
    '双宽页整张进左 cell(右 cell 空);普通跨页仍是左右两半',
  );
  assert.match(body, /\$\{full \? ' ov-full' : ''\}/, 'ov-book 必须带上 ov-full 标记供 CSS collapse');
  // solo 与 full 是互斥的两种形态:双宽页绝不能被当成 solo(那会收窄成单页宽)。
  assert.match(body, /const solo = !full && \(lp === null \|\| rp === null\)/);
});

test('ov-full collapses the empty half and the spine, mirroring book-full', () => {
  assert.match(CSS, /\.ov-book\.ov-full\s*\.ov-page\.ov-empty\s*\{[^}]*display:\s*none/);
  assert.match(CSS, /\.ov-book\.ov-full::before\s*\{[^}]*display:\s*none/);
});

test('the lazy overview repaint paths are spread-aware too', () => {
  // 三条路径都会往格子里 paint:首次 renderOverview、进视口的 paintOvSpread、
  // 单页编辑后的 repaintPages。任一条漏掉双宽,格子就会在某个时机变回空白。
  const lazy = /const paintOvSpread = \(i: number\) => \{[^]*?\n      \};/.exec(PORT);
  assert.ok(lazy, 'expected paintOvSpread');
  assert.match(lazy![0], /faces\.kind === 'full' \? \[faces\.page, null\]/);
  const repaint = /function repaintPages\([^]*?\n    \}/.exec(PORT);
  assert.ok(repaint, 'expected repaintPages');
  assert.match(repaint![0], /faces\.kind === 'full' \? \[faces\.page, null\]/);
});

// ── #303 I5:authoringFocusPageIndex 是 AI 改稿的落点。旧写法 `(lp ?? rp)?.pageIndex ?? 0`
// 对双宽页拿到两个 null,静默回落成 0 —— 用户正看着一个双宽内页说「改这句」,
// 改动被写进了封面。静默写错页比报错严重得多。

test('authoringFocusPageIndex resolves the page of a full spread, not the cover', () => {
  const fn = /function authoringFocusPageIndex\(\)[^]*?\n    \}/.exec(PORT);
  assert.ok(fn, 'expected authoringFocusPageIndex');
  assert.match(
    fn![0],
    /return spreadRealPages\(currentCh\)\[0\]\?\.pageIndex \?\? 0;/,
    '必须按「这个跨页上的真实页」取焦点页;双宽页是其中唯一一页',
  );
  assert.doesNotMatch(fn![0], /const \[lp, rp\]/, '不得再把跨页拆成左右半页来找焦点页');
});

test('spreadRealPages includes the full-spread page', () => {
  const fn = /const spreadRealPages = \(s: number\): EditorPage\[\] => \{[^]*?\n    \};/.exec(PORT);
  assert.ok(fn, 'expected spreadRealPages');
  assert.match(fn![0], /f\.kind === 'full' \? \[f\.page\] : \[f\.left, f\.right\]/);
});

// ── spreadLabel:双宽页吃两个页号,pageFolioInfos 给的是 { left, right } 对象。
// 只 filter typeof === 'number' 会把它整个丢掉 → 标签退化成「跨页 N」,没有页码。

test('spreadLabel expands a double-wide folio object into both page numbers', () => {
  const fn = /const spreadLabel = \(i: number\) => \{[^]*?\n    \};/.exec(PORT);
  assert.ok(fn, 'expected spreadLabel');
  assert.match(fn![0], /const present = spreadRealPages\(i\)/);
  assert.match(
    fn![0],
    /if \(folio && typeof folio === 'object'\) return \[folio\.left, folio\.right\]/,
    '双宽页的 folio 是 {left,right},要展开成两个页号才能给出「第 X–Y 页」',
  );
});
