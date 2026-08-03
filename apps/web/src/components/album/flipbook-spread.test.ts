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

test('a full spread renders as TWO bound half-crops of the SAME page (spine + leaf like a pair)', () => {
  // 2026-08-02 反转「整幅无中缝」的旧决定:双宽页按装订的两半渲染(拆渲染不拆数据)。
  // #303 的核心不变式仍在:两半都必须取自那**一页**(pages[sp.page]),不许出现空白面。
  const facesFn = /const facesOfSpread = useCallback\([^]*?\n  \);/.exec(tsx);
  assert.ok(facesFn, 'expected facesOfSpread');
  const body = facesFn![0];
  assert.match(body, /if \(sp\.kind === 'full'\) \{/, '双宽页必须在 facesOfSpread 里显式处理');
  assert.match(body, /const page = pages\[sp\.page\] \?\? null;/, '两半都来自真实的那一页,不许空白');
  assert.match(body, /\{ page, index: sp\.page, half: 'left' \}/, '左半裁');
  assert.match(body, /\{ page, index: sp\.page, half: 'right' \}/, '右半裁');
  // 裁半只对双宽模板生效:PageFace 按 pageBox 判宽,整幅缩放 + 右半平移一个框宽。
  assert.match(tsx, /const wide = half != null && box\.width > PAGE\.width;/);
  assert.match(tsx, /translateX\(\$\{-width\}px\) /, '右半必须左移一个框宽来裁');
});

test('the pair branch now hosts full spreads too (single open-book path, spine included)', () => {
  // 独立的 fullHere 分支退场:双宽页与 pair 走同一条摊开书路径,自动获得中缝/弧面/叶子。
  assert.match(tsx, /\{book\.w > 0 && !soloHere && \(/);
  assert.doesNotMatch(tsx, /fullHere &&/, '不许再出现独立的 fullHere 渲染分支');
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

test('the thumbnail strip renders a full spread as one double-wide thumb with a spine divider', () => {
  assert.match(tsx, /const fullIdx = fullIndexOf\(s\)/);
  // 双宽缩略图仍是 52px 的跨页格(不是 26px 的单页格),内容是一整张面;
  // 但它也是装订的两半 —— 缩略图同样带中缝分隔线。
  const fullThumb = /\) : fullIdx >= 0 \? \(([\s\S]*?)\) : \(/.exec(tsx);
  assert.ok(fullThumb, 'expected the fullIdx thumbnail branch');
  assert.match(fullThumb![1]!, /page=\{fullThumb\}[\s\S]*?width=\{52\}/);
  assert.match(fullThumb![1]!, /var\(--border-soft\)/, '双宽缩略图必须带中缝分隔线');
});

test('no-spread baseline: the solo and pair branches keep their original geometry', () => {
  // 不含双宽模板的相册里 facesOfSpread 对 pair 原样返回左右两页,渲染路径不变。
  assert.match(tsx, /\{book\.w > 0 && soloHere && \(/, 'solo 分支门闩不变');
  assert.match(tsx, /const soloHere = isSoloSpread\(spreads\[spread\], pages\)/, 'solo 判定仍按类别,不按空半页');
  // Half 恒为半页宽 —— 双宽页的「宽」由两个半面拼出来,不再有整幅宽的 Half。
  assert.match(tsx, /style=\{\{ width: halfW, height: book\.h, background: 'var\(--surface\)' \}\}/);
});
