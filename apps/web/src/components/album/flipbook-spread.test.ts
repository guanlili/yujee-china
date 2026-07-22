import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// #303 C2 回归。FlipBook 是**免登分享页**(/[locale]/s/[token] → SharedAlbum)的渲染面。
// 它过去只读 sp.left / sp.right,双宽页两个都是 null → 两块空面板,分享出去的书里
// 那一跨页是白的。这里 pin 住三件事:双宽页有自己的渲染分支、该分支是整幅宽、
// 选中同步能解析出双宽页(过去解析成 -1)。
//
// 与 flipbook-solo.test.ts 同样是源文本断言(大客户端组件无 jsdom 夹具);
// 真正的分类逻辑(buildSpreads / spreadPageIndices / spreadRenderKind)在
// spreads.test.ts 里跑的是真单测,不是源文本。

const here = dirname(fileURLToPath(import.meta.url));
const tsx = readFileSync(join(here, 'FlipBook.tsx'), 'utf8');

test('FlipBook resolves a full (double-wide) spread from the shared spreads helper', () => {
  assert.match(
    tsx,
    /import\s*\{[^}]*\bspreadFullPage\b[^}]*\}\s*from\s*'\.\/spreads'/,
    'FlipBook must resolve the full-spread page through spreadFullPage',
  );
  assert.match(tsx, /const fullIndexOf = useCallback\(\s*\n\s*\(s: number\) => spreadFullPage\(spreads\[s\]\) \?\? -1/);
});

test('a full spread renders ONE face at the FULL book width, no spine, no leaf', () => {
  const branch = /\{book\.w > 0 && !soloHere && fullHere &&([\s\S]*?)\)\}\n\n\s*\{book\.w > 0 && !soloHere && !fullHere/.exec(tsx);
  assert.ok(branch, 'expected a dedicated fullHere render branch before the pair branch');
  const body = branch![1]!;
  // 整幅宽(book.w),不是半页宽(halfW)——双宽画布本来就是两页宽。
  assert.match(body, /width: book\.w/, '双宽页容器必须是整个跨页宽');
  assert.match(body, /<Half page=\{fullPage\}[^>]*width=\{book\.w\}/, '必须只画一张面,并撑满整幅');
  assert.doesNotMatch(body, /center spine shadow|linear-gradient\(90deg, rgba\(0,0,0,0\)/, '双宽页画面连续,不得画中缝');
  assert.doesNotMatch(body, /turning leaf|leafFront/, '双宽页不参与叶子翻页');
});

test('the pair branch is now gated on !fullHere so a full spread never falls into it', () => {
  // 漏掉这个 gate 的话双宽页会同时命中两个分支,画出重叠的空白跨页。
  assert.match(tsx, /\{book\.w > 0 && !soloHere && !fullHere && \(/);
});

test('selection sync resolves a full spread to its page (not -1)', () => {
  const sync = /const syncSelectionToSpread = useCallback\([^]*?\n  \);/.exec(tsx);
  assert.ok(sync, 'expected syncSelectionToSpread');
  assert.match(
    sync![0],
    /spreadPageIndices\(spreads\[s\]\)\[0\] \?\? -1/,
    'sp.left ?? sp.right 对双宽页解析成 -1(选中不动、缩略图高亮错位);必须走 spreadPageIndices',
  );
});

test('the thumbnail strip renders a full spread as one double-wide thumb', () => {
  assert.match(tsx, /const fullIdx = fullIndexOf\(s\)/);
  // 双宽缩略图仍是 52px 的跨页格(不是 26px 的单页格),内容是一整张面。
  assert.match(tsx, /\) : fullIdx >= 0 \? \([\s\S]*?page=\{fullThumb\}[\s\S]*?width=\{52\}/);
});

test('no-spread baseline: the solo and pair branches keep their original geometry', () => {
  // 不含双宽模板的相册里 fullHere 恒 false,渲染路径与 #303 之前逐像素相同。
  assert.match(tsx, /\{book\.w > 0 && soloHere && \(/, 'solo 分支门闩不变');
  assert.match(tsx, /const soloHere = isSoloSpread\(spreads\[spread\], pages\)/, 'solo 判定仍按类别,不按空半页');
  // Half 默认宽度仍是半页宽 —— 只有双宽页显式传 book.w。
  assert.match(tsx, /width = halfW,/, 'Half 的默认宽度必须仍是半页宽');
});
