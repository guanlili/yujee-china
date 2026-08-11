import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { TEMPLATE_IDS, TEMPLATES } from '@yujee/contracts/templates';
import { interiorSpreads } from './collage';

// #303 I3 回归。双宽页曾在拼图和 Live 视频里被画成一张**很像真页面**的空白白页:
// isSoloSpread 对它返回 false,所以 interiorSpreads 会保留它(正确),但下游按
// s.left / s.right 取面 —— 双宽页两个都是 null —— 于是 drawSpread 照常画白底 + 中缝,
// 得到一张有模有样的空白跨页。这比崩掉更糟:导出的成品看不出坏了。

const collageSrc = readFileSync(new URL('./collage.ts', import.meta.url), 'utf8');
const liveSrc = readFileSync(new URL('./live-video.ts', import.meta.url), 'utf8');

test('interiorSpreads keeps a full (double-wide) interior spread', () => {
  const spreads = interiorSpreads([
    { templateId: 'mag-03' },
    { templateId: 'mag-54' },
    { templateId: 'mag-05' },
  ]);
  // 双宽页是内页,必须进拼图;它是 kind:'full',一整张面。
  assert.ok(
    spreads.some((s) => s.kind === 'full'),
    '双宽内页必须留在拼图里(它是内页,不是封面/封尾)',
  );
});

test('interiorSpreads still drops cover/ending and keeps every interior (no-spread baseline)', () => {
  // 封面 id 从注册表取(模板会被重新归类,写死 id 迟早变成假前提)。
  const coverId = TEMPLATE_IDS.find((id) => TEMPLATES[id]?.category === 'cover');
  assert.ok(coverId, '需要至少一个封面模板作为夹具');
  const spreads = interiorSpreads([
    { templateId: coverId! },
    { templateId: 'mag-03' },
    { templateId: 'mag-05' },
  ]);
  // 封面被滤掉,只剩那一个内页配对跨页,且全部是 pair —— 不含双宽模板的相册
  // 逐个跨页与改造前完全一致。
  assert.deepEqual(spreads, [{ kind: 'pair', left: 1, right: 2 }]);
});

test('collage paints a full spread as ONE face across the whole cell, no gutter', () => {
  // 双宽页的画面本来就是连续的:再画一条中缝会把一张连贯大图从正中劈开。
  assert.match(collageSrc, /if \(s\.kind === 'full'\) \{[\s\S]*?drawFullSpread\(ctx, await face\(s\.page\)/);
  const full = /function drawFullSpread\([^]*?\n\}/.exec(collageSrc);
  assert.ok(full, 'expected a drawFullSpread primitive');
  assert.doesNotMatch(full![0], /ctx\.stroke\(\)/, 'drawFullSpread 不得画中缝');
  // 配对跨页那条路径必须**保留**中缝(无双宽页的相册逐像素不变)。
  const pair = /function drawPairSpread\([^]*?\n\}/.exec(collageSrc);
  assert.ok(pair, 'expected a drawPairSpread primitive');
  assert.match(pair![0], /ctx\.stroke\(\)/, '普通跨页必须保留中缝');
});

test('collage renders every occupied page of a spread, including a full one', () => {
  // 需要渲染的 face 集合过去是「s.left / s.right 非空」,双宽页因此一张都不渲染
  // (进度条总数也跟着算少)。改成按 spreadPageIndices 收集。
  assert.match(collageSrc, /for \(const idx of spreadPageIndices\(s\)\) neededFaces\.add\(idx\)/);
});

test('live-video paints a full spread as two bound half-crops of the SAME page (and flips it)', () => {
  // 视图分类走 spreads.ts 的 spreadRenderKind(唯一真相),不再在这里各写一份。
  assert.match(liveSrc, /switch \(spreadRenderKind\(s, asEditor\)\)/);
  // #303 的核心不变式换了形态但仍在:双宽页的两半都必须取自那**一页**的真实 face,
  // 不许出现「有模有样的空白跨页」。2026-08-02 起它按装订的两半渲染(有中缝、参与翻页)。
  assert.match(
    liveSrc,
    /case 'full': \{[\s\S]*?spreadFullPage\(s\)![\s\S]*?faces: \[\{ idx: pi, half: 'left' \}, \{ idx: pi, half: 'right' \}\]/,
  );
  // 裁半在 faceOf 里做(源画布左/右半),缓存,不重复渲染。
  assert.match(liveSrc, /ref\.half === 'left' \? 0 : base\.width \/ 2/);
  // 2026-08-12:跨页(含双宽)的两个页面改由折页画 —— 它们是折页上深度 0 的那两张,
  // 翻页时要能跟着折起来。live-video 只铺底(书影 + 书口纸叠),不再自己画页面。
  assert.match(liveSrc, /paintSpreadGround\(ctx, chrome\.spread\)/);
  assert.match(liveSrc, /fanFaceIndex\(v\.faces\.length, c\.side\)/, '取哪一面走 fanFaceIndex');
  assert.doesNotMatch(liveSrc, /else if \(v\.full\)/, '不许再有独立的 full 渲染分支');
  // 翻不翻由 flipTransition 决定(与移动端同一双眼睛),不许回到本地 canFlip。
  assert.match(liveSrc, /flipTransition\(shapeOf\(views\[k\]!\), shapeOf\(views\[k \+ 1\]!\), 'next', false\)/);
  assert.match(liveSrc, /full: v\.full/);
  assert.doesNotMatch(liveSrc, /const canFlip =/, '不得回到本地 canFlip 第二真相');
});
