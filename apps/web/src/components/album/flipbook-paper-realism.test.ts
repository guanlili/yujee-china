import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// 分享页(/[locale]/s/[token])的 FlipBook 高仿真书页效果。编辑器书籍模式在
// editor-port.css 里已有同一套纸张质感(spread-paper-realism.test.ts);FlipBook
// 是**另一份实现**(内联样式,没有 CSS 文件),两边必须是同一本书:书脊沟槽 + 1px
// 接缝、左右半页向书脊的弧面明暗、三层书体投影、书口纸张堆叠(页缘)。
// 与 flipbook-solo/spread.test.ts 同为源文本断言(大客户端组件无 jsdom 夹具)。

const here = dirname(fileURLToPath(import.meta.url));
const tsx = readFileSync(join(here, 'FlipBook.tsx'), 'utf8');

function branch(gate: RegExp): string {
  const match = new RegExp(`${gate.source}([\\s\\S]*?)\\)\\}\\n\\n`, 's').exec(tsx);
  assert.ok(match, `missing render branch: ${gate.source}`);
  return match[1]!;
}

// 双宽(#303)页 2026-08-02 起与 pair 同一条渲染路径:facesOfSpread 把它裁成装订
// 在一起的左右两半(有中缝、参与翻页,拆渲染不拆数据),独立的 fullHere 分支退场。
const solo = branch(/\{book\.w > 0 && soloHere && \(/);
const pair = branch(/\{book\.w > 0 && !soloHere && \(/);

test('the open spread carries the editor fold-band recipe: wide gutter gradient + 1px seam', () => {
  // 沟槽是随书宽的折光带(spineW),不是过去那条 24px 的平面淡影。
  assert.match(pair, /width: spineW/, 'the fold band must size from spineW, not a hard-coded 24');
  assert.match(
    pair,
    /rgba\(0,0,0,\.24\) 50%/,
    'the fold band must keep the editor gradient (darkest at the 50% fold line)',
  );
  // 1px 接缝带两侧受光(白)/背光(黑)描边 —— editor-port .book::after 的同款。
  assert.match(pair, /width: 1,\s*\n\s*background: 'rgba\(16,20,19,\.28\)'/);
  assert.match(pair, /-1px 0 rgba\(255,255,255,\.12\), 1px 0 rgba\(0,0,0,\.08\)/);
});

test('the open spread shades both halves toward the spine (page curvature)', () => {
  assert.match(pair, /transparent 72%, rgba\(255,255,255,\.06\) 86%, rgba\(0,0,0,\.13\) 100%/);
  assert.match(pair, /rgba\(0,0,0,\.12\) 0%, rgba\(255,255,255,\.07\) 14%, transparent 28%/);
});

test('every resting book branch carries the shared book-body look (3-layer shadow + paper edges)', () => {
  for (const [name, body] of [['solo', solo], ['pair', pair]] as const) {
    assert.match(body, /boxShadow: BOOK_SHADOW/, `${name} branch must use the shared BOOK_SHADOW`);
    assert.match(body, /<PaperEdges /, `${name} branch must render the stacked paper edges`);
  }
  // solo 是合上的书:纸叠只在开口侧(封面朝右、封尾朝左),不能两侧都露纸芯。
  assert.match(solo, /sides=\{\[spread === 0 \? 'right' : 'left'\]\}/);
  // 摊开的跨页(pair 与双宽同路)两侧都露纸芯。
  assert.match(pair, /sides=\{\['left', 'right'\]\}/);
});

test('paper-edge strips are decorative: hidden from a11y and clicks, outside the clipped book face', () => {
  const component = /function PaperEdges\(\{[\s\S]*?\n\}/.exec(tsx);
  assert.ok(component, 'expected the PaperEdges helper component');
  assert.match(component![0], /aria-hidden/);
  assert.match(component![0], /pointer-events-none/);
  // 纸线画在书体矩形之外([side]: -width);book face 自身 overflow:hidden,
  // 塞进去会被裁掉 —— 所以必须挂在不裁剪的外层包裹上。
  assert.match(component![0], /\[side\]: -width/);
});

test('the turning leaf carries a moving-paper box-shadow and never a filter (flattens preserve-3d)', () => {
  const leaf = /\{\/\* turning leaf \*\/\}([\s\S]*?)backfaceVisibility/.exec(tsx);
  assert.ok(leaf, 'expected the turning leaf block');
  assert.match(leaf![1]!, /boxShadow:/, 'the leaf must cast its own moving shadow');
  assert.doesNotMatch(leaf![1]!, /filter:/, 'filter on the 3D leaf flattens its two faces (editor lesson)');
});
