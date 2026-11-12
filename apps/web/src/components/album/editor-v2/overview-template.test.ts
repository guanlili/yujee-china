import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildOverviewHtml, OV_ATTR } from './overview-template';

const spread = (left: number | null, right: number | null, full = false) => ({
  label: `第 ${left ?? '—'}-${right ?? '—'} 页`,
  full,
  leftIndex: left,
  rightIndex: right,
});

test('三个契约属性名必须原样出现在输出里', () => {
  const html = buildOverviewHtml([spread(0, 1)], { currentIndex: 0, selectedPageIndex: null });
  // 少一个属性 = 进入画板后整屏空白 / 点页没反应,且不会有任何类型报错。
  assert.match(html, new RegExp(`${OV_ATTR.index}="0"`));
  assert.match(html, new RegExp(`${OV_ATTR.face}="0-l"`));
  assert.match(html, new RegExp(`${OV_ATTR.face}="0-r"`));
  assert.match(html, new RegExp(`${OV_ATTR.pageIndex}="0"`));
  assert.match(html, new RegExp(`${OV_ATTR.pageIndex}="1"`));
});

test('face 序号用跨页号而不是页号,左右两侧各自成立', () => {
  const html = buildOverviewHtml([spread(0, 1), spread(2, 3)], { currentIndex: 0, selectedPageIndex: null });
  assert.match(html, new RegExp(`${OV_ATTR.face}="1-l"`));
  assert.match(html, new RegExp(`${OV_ATTR.face}="1-r"`));
  assert.ok(!html.includes(`${OV_ATTR.face}="2-l"`), '跨页号为 1 时不该出现 2-l');
});

test('选中页只在对应一侧标 ov-page-selected', () => {
  const html = buildOverviewHtml([spread(0, 1), spread(2, 3)], { currentIndex: 0, selectedPageIndex: 3 });
  const cells = html.split(`${OV_ATTR.face}="`);
  // 页号 3 是第二个跨页的右 cell:只有它带选中类。
  assert.ok(cells[3].includes('ov-page-selected'), '右 cell(pageIndex=3)应带选中类');
  assert.ok(!cells[1].includes('ov-page-selected'), '左 cell(pageIndex=2)不该带选中类');
});

test('空 cell 的 page-index 是空串,并标 ov-empty', () => {
  const html = buildOverviewHtml([spread(0, null)], { currentIndex: 0, selectedPageIndex: null });
  assert.match(html, new RegExp(`${OV_ATTR.pageIndex}=""`));
  assert.match(html, /ov-right ov-empty/);
});

test('solo 跨页带 ov-solo;full 双宽页右 cell 为空但不带 ov-solo', () => {
  const soloHtml = buildOverviewHtml([spread(0, null)], { currentIndex: 0, selectedPageIndex: null });
  assert.match(soloHtml, /ov-book ov-solo/);

  const fullHtml = buildOverviewHtml([spread(0, null, true)], { currentIndex: 0, selectedPageIndex: null });
  assert.match(fullHtml, /ov-full/);
  // full 时 solo 判定必须被 !full 挡掉,否则双宽页会同时挂 ov-solo 让底色消失。
  assert.ok(!fullHtml.includes('ov-solo'), 'full 页不该带 ov-solo');
});

test('当前章节跨页带 ov-current', () => {
  const html = buildOverviewHtml([spread(0, 1), spread(2, 3)], { currentIndex: 1, selectedPageIndex: null });
  assert.equal((html.match(/ov-current/g) ?? []).length, 1, '只能有一个跨页高亮');
  // 按跨页边界切开,逐块判定 —— ov-current 在 data-ovidx 之前,不能靠字符串位置推。
  const blocks = html.split('<div class="ov-spread').slice(1);
  assert.equal(blocks.length, 2);
  assert.ok(blocks[1]!.includes('ov-current'), 'ov-current 应落在第 2 个跨页');
  assert.ok(!blocks[0]!.includes('ov-current'), '第 1 个跨页不该高亮');
});

test('空数组产出空串,不产生孤儿标签', () => {
  assert.equal(buildOverviewHtml([], { currentIndex: 0, selectedPageIndex: null }), '');
});

test('pageIndex 为 0 时不能被当成空值吞掉', () => {
  const html = buildOverviewHtml([spread(0, 1)], { currentIndex: 0, selectedPageIndex: 0 });
  assert.match(html, new RegExp(`${OV_ATTR.pageIndex}="0"`), 'pageIndex=0 必须序列化成 "0" 而不是 ""');
  assert.ok(html.includes('ov-page-selected'), 'selectedPageIndex=0 必须能匹配到第 1 页');
});
