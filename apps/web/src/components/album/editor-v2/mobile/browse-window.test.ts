import assert from 'node:assert/strict';
import { test } from 'node:test';

import { browseScreen, stepScreen, screenStartOfPage } from './browse-window';
import { buildSpreads } from '../../spreads';
import type { EditorPage } from '../../types';

/* ════════════════════════════════════════════════════════════════════════════
   browse-window —— 浏览态「这一屏该显示什么」的纯逻辑。

   旧实现把这件事写成了对桌面 renderOverview 产出的 DOM 做 display:none
   (mobile-canvas.ts) —— 桌面一重建就被冲刷,正是要拆掉的耦合。
   这里换成纯函数:输入开页表 + 页游标 + 密度,输出该显示哪些开页,不碰任何 DOM。

   密度按【开页】为单位(#304 用户反馈):1=单页 / 2=一个开页 / 4=两个开页竖排;
   封面/封底(独页)在任何密度下都单页独占一屏。
   ════════════════════════════════════════════════════════════════════════════ */

function page(templateId: string): EditorPage {
  return { pageIndex: 0, templateId, imagesJson: {}, textsJson: {} };
}

// 用真实模板 id:开页/独页规则由模板 category 决定(mag-01=cover / mag-03=interior /
// mag-20=ending),编造的 id 会被当成内页,测出来的结构就不是线上那本书。
// 封面(独页) + 6 内页(3 个开页) + 封底(独页) → spreads: [封面][1,2][3,4][5,6][封底]
function book(): EditorPage[] {
  return [
    page('mag-01'),
    ...Array.from({ length: 6 }, () => page('mag-03')),
    page('mag-20'),
  ];
}

test('开页表就是桌面那套 buildSpreads —— 封面/封底天然独页,不用另写一套', () => {
  const spreads = buildSpreads(book());
  // #303 起 Spread 是判别式联合(kind:'pair' | 'full'),配对语义不变。
  assert.deepEqual(spreads[0], { kind: 'pair', left: null, right: 0 }, '封面开在右手页');
  assert.deepEqual(spreads[1], { kind: 'pair', left: 1, right: 2 }, '内页成对');
  assert.deepEqual(spreads.at(-1), { kind: 'pair', left: 7, right: null }, '封底收在左手页');
});

test('密度 1:只显示游标那一页,同开页的另一页不显示', () => {
  const b = book();
  const s = browseScreen(buildSpreads(b), b, 2, 1);
  assert.deepEqual(s.spreadIndices, [1], '仍落在它所属的开页里');
  assert.equal(s.onlyPage, 2, '开页内只留这一页');
});

test('密度 2:显示游标所在的整个开页(左右两页都在)', () => {
  const b = book();
  const s = browseScreen(buildSpreads(b), b, 2, 2);
  assert.deepEqual(s.spreadIndices, [1]);
  assert.equal(s.onlyPage, null, '不挑页,整开页都显示');
});

test('密度 4:显示游标所在开页 + 下一个开页(竖排两个)', () => {
  const b = book();
  const s = browseScreen(buildSpreads(b), b, 1, 4);
  assert.deepEqual(s.spreadIndices, [1, 2]);
  assert.equal(s.onlyPage, null);
});

test('密度 4 到末尾:不足两个开页时短返回,不产出越界空格子', () => {
  const b = book();
  const spreads = buildSpreads(b);
  const s = browseScreen(spreads, b, 7, 4); // 7 = 封底,独页独占
  assert.deepEqual(s.spreadIndices, [spreads.length - 1]);
});

test('封面/封底独页:任何密度都单页独占一屏,不与相邻开页同屏', () => {
  const b = book();
  const spreads = buildSpreads(b);
  // 密度 4 下,封面(游标 0)只显示自己这一个开页
  assert.deepEqual(browseScreen(spreads, b, 0, 4).spreadIndices, [0], '封面独占');
  // 封底(游标 7)同理
  assert.deepEqual(browseScreen(spreads, b, 7, 4).spreadIndices, [spreads.length - 1], '封底独占');
  // 密度 4 从封面往后翻:落到第一个内页开页(不是把封面和它凑一屏)
  assert.equal(stepScreen(spreads, b, 0, 4, 1), 1);
});

test('游标不在任何开页(越界/空书)→ 回落到第一个开页,不炸', () => {
  const b = book();
  assert.deepEqual(browseScreen(buildSpreads(b), b, 999, 2).spreadIndices, [0]);
  assert.deepEqual(browseScreen([], [], 0, 2).spreadIndices, [], '空书:什么都不显示');
});

test('翻屏:密度 1 按页走,密度 2 按开页走,密度 4 一次跨两个开页', () => {
  const b = book();
  const spreads = buildSpreads(b);
  // 密度 1:2 → 3(逐页)
  assert.equal(stepScreen(spreads, b, 2, 1, 1), 3);
  // 密度 2:游标在开页1(页1-2)→ 开页2(页3-4)的第一页
  assert.equal(stepScreen(spreads, b, 1, 2, 1), 3);
  // 密度 4:开页1+2 一屏 → 下一屏开页3(页5-6)
  assert.equal(stepScreen(spreads, b, 1, 4, 1), 5);
});

test('翻屏:到头到尾都夹住,不会翻出书外', () => {
  const b = book();
  const spreads = buildSpreads(b);
  assert.equal(stepScreen(spreads, b, 0, 2, -1), 0, '封面再往前还是封面');
  assert.equal(stepScreen(spreads, b, 7, 2, 1), 7, '封底再往后还是封底');
});

test('翻屏往回:密度 2 落到上一个开页的左页(不是右页)', () => {
  const b = book();
  const spreads = buildSpreads(b);
  // 游标在开页2(页3-4)→ 上一屏是开页1,应落在页 1(左页)
  assert.equal(stepScreen(spreads, b, 3, 2, -1), 1);
});

test('screenStartOfPage:跳到某页时,游标对齐到该页所在屏的起点', () => {
  const b = book();
  const spreads = buildSpreads(b);
  // 密度 2:跳到页 4 → 该屏起点是页 3(开页2 的左页)
  assert.equal(screenStartOfPage(spreads, b, 4, 2), 3);
  // 密度 1:跳到哪页就是哪页
  assert.equal(screenStartOfPage(spreads, b, 4, 1), 4);
  // 密度 4:开页1+2 同屏(封面已独占),页 4 在开页2 → 该屏起点是页 1
  assert.equal(screenStartOfPage(spreads, b, 4, 4), 1);
});
