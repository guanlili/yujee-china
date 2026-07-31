import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { EditorPage } from '../types';
import {
  SWAP_EDGE_ZONE,
  SWAP_LONG_PRESS_MS,
  edgeFlipDirection,
  exceedsLongPressSlop,
  sameSwapSlot,
  swapImageSlots,
} from './image-swap';

const page = (
  pageIndex: number,
  images: Record<string, string>,
  imagePos: EditorPage['imagePosJson'] = {},
): EditorPage =>
  ({
    pageIndex,
    templateId: 'tpl',
    imagesJson: images,
    textsJson: {},
    imagePosJson: imagePos,
    htmlJson: '<div data-template="tpl"><img data-image-slot="a" src="{{IMG_SRC:a}}"></div>',
  }) as unknown as EditorPage;

test('同页两个图槽对调', () => {
  const pages = [page(0, { a: 'p1', b: 'p2' })];
  const out = swapImageSlots(pages, { pageIndex: 0, slotId: 'a' }, { pageIndex: 0, slotId: 'b' });
  assert.ok(out);
  assert.deepEqual(out.pages[0]!.imagesJson, { a: 'p2', b: 'p1' });
  assert.deepEqual(out.touched, [0]);
});

test('同页交换只打在一份新 record 上 —— 分开做会互相覆盖', () => {
  // 回归守卫:先 {...images, a: toPhoto} 再 {...images, b: fromPhoto} 各基于旧 record,
  // 后者会把前者的改动抹掉,结果是 a 没换成、b 换成了自己。
  const pages = [page(0, { a: 'p1', b: 'p2', c: 'p3' })];
  const out = swapImageSlots(pages, { pageIndex: 0, slotId: 'a' }, { pageIndex: 0, slotId: 'b' })!;
  assert.equal(out.pages[0]!.imagesJson.a, 'p2');
  assert.equal(out.pages[0]!.imagesJson.b, 'p1');
  assert.equal(out.pages[0]!.imagesJson.c, 'p3', '旁边的槽不许被牵连');
});

test('跨页交换:两页都换,其余页保持对象同一性', () => {
  const untouched = page(1, { z: 'p9' });
  const pages = [page(0, { a: 'p1' }), untouched, page(2, { b: 'p2' })];
  const out = swapImageSlots(pages, { pageIndex: 0, slotId: 'a' }, { pageIndex: 2, slotId: 'b' })!;
  assert.equal(out.pages[0]!.imagesJson.a, 'p2');
  assert.equal(out.pages[2]!.imagesJson.b, 'p1');
  assert.equal(out.pages[1], untouched, '没动的页不该产生新对象(React 才不会白重渲)');
  assert.deepEqual(out.touched, [0, 2]);
});

test('拖进空框 = 移动过去,原槽删 key 而不是置空串', () => {
  const pages = [page(0, { a: 'p1' }), page(1, {})];
  const out = swapImageSlots(pages, { pageIndex: 0, slotId: 'a' }, { pageIndex: 1, slotId: 'b' })!;
  assert.equal(out.pages[1]!.imagesJson.b, 'p1');
  assert.equal('a' in out.pages[0]!.imagesJson, false, '空槽要删 key,不留假记录');
});

test('位置/缩放留在原槽,不跟着照片走(与「换图」同口径)', () => {
  const pages = [
    page(0, { a: 'p1' }, { a: { x: 10, y: 20, scale: 1.4 } }),
    page(1, { b: 'p2' }, { b: { x: 90, y: 5, scale: 1 } }),
  ];
  const out = swapImageSlots(pages, { pageIndex: 0, slotId: 'a' }, { pageIndex: 1, slotId: 'b' })!;
  assert.deepEqual(out.pages[0]!.imagePosJson, { a: { x: 10, y: 20, scale: 1.4 } });
  assert.deepEqual(out.pages[1]!.imagePosJson, { b: { x: 90, y: 5, scale: 1 } });
});

test('交换不碰存库 html —— 图片位是 token,碰了就烘死', () => {
  const pages = [page(0, { a: 'p1', b: 'p2' })];
  const before = pages[0]!.htmlJson;
  const out = swapImageSlots(pages, { pageIndex: 0, slotId: 'a' }, { pageIndex: 0, slotId: 'b' })!;
  assert.equal(out.pages[0]!.htmlJson, before);
});

test('无意义的交换一律返回 null', () => {
  const pages = [page(0, { a: 'p1' }), page(1, {})];
  assert.equal(
    swapImageSlots(pages, { pageIndex: 0, slotId: 'a' }, { pageIndex: 0, slotId: 'a' }),
    null,
    '落回原槽',
  );
  assert.equal(
    swapImageSlots(pages, { pageIndex: 1, slotId: 'x' }, { pageIndex: 1, slotId: 'y' }),
    null,
    '两个空槽',
  );
  assert.equal(
    swapImageSlots(pages, { pageIndex: 0, slotId: 'a' }, { pageIndex: 7, slotId: 'b' }),
    null,
    '目标页不存在',
  );
  assert.equal(
    swapImageSlots([page(0, { a: 'p1', b: 'p1' })], { pageIndex: 0, slotId: 'a' }, { pageIndex: 0, slotId: 'b' }),
    null,
    '同一张照片,换了也看不出变化',
  );
});

test('sameSwapSlot 认页 + 槽,null 一律不相等', () => {
  assert.equal(sameSwapSlot({ pageIndex: 1, slotId: 'a' }, { pageIndex: 1, slotId: 'a' }), true);
  assert.equal(sameSwapSlot({ pageIndex: 1, slotId: 'a' }, { pageIndex: 2, slotId: 'a' }), false);
  assert.equal(sameSwapSlot({ pageIndex: 1, slotId: 'a' }, null), false);
  assert.equal(sameSwapSlot(null, null), false);
});

test('长按拾起前位移超阈值就取消(那是平移/翻页,不是长按)', () => {
  assert.equal(exceedsLongPressSlop(0, 0), false);
  assert.equal(exceedsLongPressSlop(8, 0), false);
  assert.equal(exceedsLongPressSlop(9, 0), true);
  assert.equal(exceedsLongPressSlop(0, -9), true);
  assert.ok(SWAP_LONG_PRESS_MS >= 300 && SWAP_LONG_PRESS_MS < 500, '比误触长、比 iOS 长按菜单短');
});

test('边缘自动翻页:左缘 -1 / 右缘 +1 / 中间 null', () => {
  const rect = { left: 0, width: 400 };
  assert.equal(edgeFlipDirection(10, rect), -1);
  assert.equal(edgeFlipDirection(395, rect), 1);
  assert.equal(edgeFlipDirection(200, rect), null);
  // 画板带偏移时按视口坐标算
  assert.equal(edgeFlipDirection(110, { left: 100, width: 400 }), -1);
});

test('画板窄到整块都是边缘区时不自动翻页(否则一拾起就狂翻)', () => {
  assert.equal(edgeFlipDirection(5, { left: 0, width: SWAP_EDGE_ZONE * 2 }), null);
});
