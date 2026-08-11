import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// Live 导出的翻页曾经与移动端画布**逐帧同源**:同一套 flip.ts 决定哪张纸、往哪转、
// 几毫秒。2026-08-12 内页翻页从那条路上分了出去,这个文件因此改成锁两件事:
//
//   1. **哪些还必须同源** —— 能不能翻(flipTransition)、封面怎么开、封底怎么合
//      (edgeMotion/edgeLayers/edgeUnderAlpha)。这些是「书的语义」,分叉就等于两边
//      对同一本书的理解不一致,迟早出现导出能翻、App 里翻不了这种事。
//   2. **哪些是刻意分叉的,以及为什么** —— 内页翻页改成折页模型、370ms、去掉书脊
//      沟槽与弧面明暗。理由写在下面每条断言里,免得后人当成腐化又「修」回去。
//
// (live-video 是 DOM+WebCodecs 客户端代码,仓里没有 jsdom 夹具,故做源文本断言。)

const here = dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(join(here, 'live-video.ts'), 'utf8');
// 注释里要讲清楚什么退场了、为什么,所以断言只看代码本身。
const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

test('书的语义仍与移动端 flip.ts 同源:能不能翻、封面怎么开合', () => {
  assert.match(src, /from '@\/components\/album\/editor-v2\/mobile\/flip'/);
  for (const name of ['flipTransition', 'edgeMotion', 'edgeLayers']) {
    assert.match(src, new RegExp(`\\b${name}\\(`), `${name} must be called, not re-derived`);
  }
  assert.match(src, /edgeUnderAlpha\(/);
  assert.match(src, /transitionFrameCount\(EDGE_FLIP_MS, FPS\)/, '封面开合仍取移动端时长');
  assert.match(src, /startShiftPct/, '开合时书体必须按 edgeMotion 平移');
});

test('内页翻页刻意不再是「叶片盖在目标跨页上」——那套被成片证伪过', () => {
  // 旧做法:leafLayers 取出 under/front/back,把目标跨页整张画在底下,再让一张纸
  // 绕书脊扫过去。问题是那张纸一进中段就压成一条细缝,而新内容从第一帧起已经完整
  // 摊在底下 —— 2026-08-12 把成片与参考录屏同尺度并排逐帧比对,整段翻页几乎看不出
  // 在动。现在跨页翻页由折页推进一格完成(见 live-fan-geometry)。
  assert.doesNotMatch(src, /function paintSpreadFlip\(/, '叶片式跨页翻页不许回来');
  assert.doesNotMatch(src, /\bleafLayers\(/, '跨页翻页不再用 leafLayers 分三层');
  assert.match(src, /const e = flipEase\(t\);/, '推进量必须走 flip.ts 的缓动');
  assert.match(src, /paintFan\(ctx, k \+ e, SPINE, 1\)/, '跨页翻页 = 折页推进一格');
  // 折页只交代留在两侧的页;横穿书脊那张纸(k 的右页 / k+1 的左页是它的正反面)
  // 必须另画,否则翻页途中书的正中是空的 —— 这个洞被成片实拍到过。
  assert.match(src, /paintTurningLeaf\(ctx, a, b, e\)/, '转动中的那张纸不能漏');
});

test('内页翻页 370ms,是照参考录屏量的,不是随手改小的', () => {
  // 逐帧差分实测:参考录屏单次翻页 ≈370ms、间隔 ≈730ms。移动端那 900ms 拖在
  // 折页模型上会散掉;封面开合不受影响,仍走 EDGE_FLIP_MS。
  assert.match(src, /const SPREAD_FLIP_MS = 370;/);
  assert.match(src, /transitionFrameCount\(SPREAD_FLIP_MS, FPS\)/);
  assert.match(src, /flipEase\(t\)/, '缓动仍取 flip.ts 的 FLIP_EASE');
});

test('封面开合那条路仍是真透视叶片 + 移动端受光配方', () => {
  // 开合时书体确实在平移、封皮确实绕书脊转,叶片模型在那里仍然对,别一起拆了。
  assert.match(src, /px\(PERSPECTIVE\)/, 'perspective must scale with the CSS_DPR viewport mapping');
  assert.match(src, /projectLeafColumn\(/);
  for (const name of ['LEAF_FRONT_EDGE', 'LEAF_BACK_EDGE', 'leafShadeStops', 'LEAF_SHADOW', 'LEAF_INSET_RING']) {
    assert.match(src, new RegExp(`\\b${name}\\b`), `leaf must use ${name}`);
  }
  // 旧的假 3D:cos 挤压宽度 + 平涂 rgba(20,26,38,…) 当受光 —— 不许回来。
  assert.doesNotMatch(src, /HALF_W \* Math\.cos/);
  assert.doesNotMatch(src, /rgba\(20,26,38/);
});

test('书体投影与书口纸叠保留;书脊沟槽与弧面明暗刻意退场', () => {
  for (const name of ['PAPER_STACK', 'SPREAD_BOOK_SHADOW', 'SOLO_BOOK_SHADOW', 'SOLO_INSET_RINGS', 'EDGE_BOOK_SHADOW']) {
    assert.match(src, new RegExp(`\\b${name}\\b`), `book chrome must use ${name}`);
  }
  // 那套仿真是为「平摊着看」补厚度的。现在页面绕自己内侧的竖轴折起来,立体感由
  // 折叠本身交代,再压一道深沟只会抢戏(2026-08-12 用户拍板)。
  for (const gone of ['SPINE_CREASE', 'SPINE_SEAM', 'PAGE_SPINE_LEFT', 'PAGE_SPINE_RIGHT']) {
    assert.doesNotMatch(src, new RegExp(`\\b${gone}\\b`), `${gone} 已退场,不该再出现`);
  }
});

test('翻不了的场景(移动端直切)在视频里仍用交叉淡出,不硬切', () => {
  assert.match(src, /ctx\.globalAlpha = 1 - t/);
});
