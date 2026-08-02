import assert from 'node:assert/strict';
import test from 'node:test';

import { TEMPLATE_IDS, TEMPLATES } from '@yujee/contracts/templates';
import {
  applyMove,
  buildInsertPermutation,
  gapFromPointer,
  isAnchoredTemplate,
  legalGaps,
  type CellRect,
} from './page-reorder';

/* 页序弹窗的纯逻辑(2026-08-02 设计):工作序 order[pos] = 原始下标;缝隙 g 指
   「插到工作序第 g 条之前」(0..n);合法 ⇔ 移动后没有任何锚定页下标变化。 */

// 与 spreads.test.ts 同法:类目从注册表现查,不硬编码「某 id 是封面」。
const idOf = (pred: (t: (typeof TEMPLATES)[string]) => boolean) =>
  TEMPLATE_IDS.find((id) => pred(TEMPLATES[id]!));
const COVER = idOf((t) => t.category === 'cover')!;
const TOC = idOf((t) => t.category === 'toc')!;
const ENDING = idOf((t) => t.category === 'ending')!;
const BODY = idOf((t) => !['cover', 'toc', 'ending'].includes(t.category))!;

// 典型书:封面 目录 A B C 封尾(A/B/C 是内容页,原始下标 2/3/4)
const IDS = [COVER, TOC, BODY, BODY, BODY, ENDING];
const IDENTITY = [0, 1, 2, 3, 4, 5];

test('锚定识别:cover/toc/ending 锚定,内容页不锚定', () => {
  assert.equal(isAnchoredTemplate(COVER), true);
  assert.equal(isAnchoredTemplate(TOC), true);
  assert.equal(isAnchoredTemplate(ENDING), true);
  assert.equal(isAnchoredTemplate(BODY), false);
});

test('legalGaps:内容页只能落在内容区缝隙(不许推挤目录/封尾)', () => {
  // 拖 A(工作序位 2):g=0/1 会把封面或目录往后推,g=6 会把封尾往前拉,都非法。
  assert.deepEqual(legalGaps(IDS, IDENTITY, 2), [2, 3, 4, 5]);
});

test('legalGaps 防御:书中间意外出现锚定页时,移动不得跨过它', () => {
  const ids = [COVER, BODY, ENDING, BODY]; // 畸形但要稳:ENDING 在中间
  assert.deepEqual(legalGaps(ids, [0, 1, 2, 3], 1), [1, 2]);
  assert.deepEqual(legalGaps(ids, [0, 1, 2, 3], 3), [3, 4]);
});

test('applyMove:前移/后移/原地(g=from 与 g=from+1 都是无操作)', () => {
  assert.deepEqual(applyMove(IDENTITY, 4, 2), [0, 1, 4, 2, 3, 5]); // C 插到 A 前
  assert.deepEqual(applyMove(IDENTITY, 2, 5), [0, 1, 3, 4, 2, 5]); // A 插到封尾前
  assert.deepEqual(applyMove(IDENTITY, 3, 3), IDENTITY);
  assert.deepEqual(applyMove(IDENTITY, 3, 4), IDENTITY);
});

test('连拖复合 + buildInsertPermutation 的 perm[newIndex]=oldIndex 语义', () => {
  let order = IDENTITY;
  order = applyMove(order, 4, 2); // [0,1,4,2,3,5]
  order = applyMove(order, 3, 5); // [0,1,4,3,2,5]
  const perm = buildInsertPermutation(order)!;
  assert.deepEqual(perm, [0, 1, 4, 3, 2, 5]);
  // 端点/提交侧的应用公式:next[newIdx] = prev[perm[newIdx]]
  const prev = ['封面', '目录', 'A', 'B', 'C', '封尾'];
  assert.deepEqual(perm.map((oldIdx) => prev[oldIdx]), ['封面', '目录', 'C', 'B', 'A', '封尾']);
  // 双射性
  assert.equal(new Set(perm).size, perm.length);
});

test('恒等工作序 → null(调用方零请求短路)', () => {
  assert.equal(buildInsertPermutation(IDENTITY), null);
  assert.equal(buildInsertPermutation(applyMove(IDENTITY, 3, 4)), null);
});

test('gapFromPointer:取最近合法缝隙,行尾/行首双锚点,超距返回 null', () => {
  // 两行布局,每格 100×150,行内 3 格:pos0/1/2 在 y=0 行,pos3/4/5 在 y=160 行
  const cell = (cx: number, cy: number): CellRect => ({ left: cx, top: cy, width: 100, height: 150 });
  const cells = [cell(0, 0), cell(110, 0), cell(220, 0), cell(0, 160), cell(110, 160), cell(220, 160)];
  const legal = [2, 3, 4, 5];
  // 指针贴近第 1 行第 2 格左缘 → 缝隙 2
  assert.equal(gapFromPointer(cells, legal, 218, 75, 160), 2);
  // 行尾:指针在第 1 行末格右侧 → 缝隙 3 的「上一格右缘」锚点接住
  assert.equal(gapFromPointer(cells, legal, 330, 75, 160), 3);
  // 行首:指针在第 2 行首格左缘 → 也是缝隙 3(双锚点等价)
  assert.equal(gapFromPointer(cells, legal, 2, 235, 160), 3);
  // 距离全部超阈 → null(拖在锁定区上空不给插入条)
  assert.equal(gapFromPointer(cells, legal, 2000, 2000, 160), null);
  // 非法缝隙永不返回
  assert.equal(gapFromPointer(cells, [5], 0, 0, 10_000), 5);
});
