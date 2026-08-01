import assert from 'node:assert/strict';
import test from 'node:test';

import { TEMPLATE_IDS, TEMPLATES } from '@yujee/contracts/templates';
import { buildSpreads } from '../spreads';
import type { EditorPage } from '../types';
import {
  buildSwapPermutation,
  canSwapUnits,
  pairUnitOfPage,
  swapUnitOfPage,
} from './page-swap';

/* ════════════════════════════════════════════════════════════════════════════
   整页交换的纯逻辑(2026-08-01 设计,docs/specs/2026-08-01-swap-gesture-and-
   page-swap-design.md)。

   交换以「页记录块」为单位:单页 1 条、跨页大页(full)1 条、对页(pair)2 条。
   左右页归属由 placePages 顺序贪心推导,所以合法性规则的底线是**块对调后下游
   配对不移位**:单↔单 / 大↔大原地对调显然安全;大↔对页是 1 条换 2 条,块整体
   互换后中间各 pair 成员依旧相邻,同样安全 —— 这正是「大页只能两页两页一起换」
   的结构学依据。单页↔大页则会让下游全体翻面,禁止。
   ════════════════════════════════════════════════════════════════════════════ */

// 与 spreads.test.ts 同法:类目从注册表现查,不硬编码「某 id 是封面」。
const idOf = (pred: (t: (typeof TEMPLATES)[string]) => boolean) =>
  TEMPLATE_IDS.find((id) => pred(TEMPLATES[id]!));
const COVER = idOf((t) => t.category === 'cover')!;
const TOC = idOf((t) => t.category === 'toc')!;
const ENDING = idOf((t) => t.category === 'ending')!;
const SPREAD = idOf((t) => t.spread === true)!;
const INTERIOR = idOf((t) => t.category === 'interior' && t.spread !== true) ?? 'mag-03';

test('fixture premise: 四类模板都存在', () => {
  assert.ok(COVER && TOC && ENDING && SPREAD && INTERIOR);
});

function page(templateId: string, pageIndex: number): EditorPage {
  return { pageIndex, templateId, imagesJson: {}, textsJson: {} };
}

/** 封面 + 两对内页 + 一张大页 + 封底:
 *  下标  0      1  2      3  4      5       6
 *  跨页  [0]    [1,2]     [3,4]     [5全宽]  [6]        */
const BOOK = [
  page(COVER, 0),
  page(INTERIOR, 1),
  page(INTERIOR, 2),
  page(INTERIOR, 3),
  page(INTERIOR, 4),
  page(SPREAD, 5),
  page(ENDING, 6),
];

test('swapUnitOfPage:单页/大页/不可动页', () => {
  assert.deepEqual(swapUnitOfPage(BOOK, 1), { kind: 'single', indices: [1] });
  assert.deepEqual(swapUnitOfPage(BOOK, 4), { kind: 'single', indices: [4] });
  assert.deepEqual(swapUnitOfPage(BOOK, 5), { kind: 'full', indices: [5] });
  assert.equal(swapUnitOfPage(BOOK, 0), null, '封面不可动');
  assert.equal(swapUnitOfPage(BOOK, 6), null, '封底不可动');
  assert.equal(swapUnitOfPage([page(COVER, 0), page(TOC, 1)], 1), null, '目录不可动');
  assert.equal(swapUnitOfPage(BOOK, 99), null, '越界');
});

test('pairUnitOfPage:两侧齐全的对页才有整体单元', () => {
  assert.deepEqual(pairUnitOfPage(BOOK, 1), { kind: 'pair', indices: [1, 2] });
  assert.deepEqual(pairUnitOfPage(BOOK, 2), { kind: 'pair', indices: [1, 2] });
  assert.equal(pairUnitOfPage(BOOK, 5), null, '大页没有 pair 单元');
  assert.equal(pairUnitOfPage(BOOK, 0), null, '封面 solo 不是 pair');
  // 奇数尾巴:单边 pair 不能作为「对页整体」参与交换(那半空页不是可搬的记录)。
  const odd = [page(COVER, 0), page(INTERIOR, 1)];
  assert.equal(pairUnitOfPage(odd, 1), null);
});

test('canSwapUnits:单↔单、大↔大、大↔对页;其余拒绝', () => {
  const s1 = { kind: 'single' as const, indices: [1] };
  const s3 = { kind: 'single' as const, indices: [3] };
  const f = { kind: 'full' as const, indices: [5] };
  const p = { kind: 'pair' as const, indices: [1, 2] };
  assert.ok(canSwapUnits(s1, s3));
  assert.ok(canSwapUnits(f, { kind: 'full', indices: [7] }));
  assert.ok(canSwapUnits(f, p));
  assert.ok(canSwapUnits(p, f), '方向无关');
  assert.ok(!canSwapUnits(s1, f), '单↔大会让下游全翻面');
  assert.ok(!canSwapUnits(s1, p));
  assert.ok(!canSwapUnits(p, { kind: 'pair', indices: [3, 4] }), 'pair↔pair 不做(等价两次单↔单)');
  assert.ok(!canSwapUnits(s1, { kind: 'single', indices: [1] }), '同一单元');
  assert.ok(!canSwapUnits(f, { kind: 'pair', indices: [5, 6] }), 'indices 相交');
});

test('buildSwapPermutation:单↔单只动两位', () => {
  const perm = buildSwapPermutation(
    7,
    { kind: 'single', indices: [1] },
    { kind: 'single', indices: [4] },
  );
  assert.deepEqual(perm, [0, 4, 2, 3, 1, 5, 6]);
});

test('buildSwapPermutation:大↔对页,中间页整体平移且是双射', () => {
  // [c | p1 p2 | m3 m4 | F5 | e6],交换 (1,2)↔(5):
  // 新序 = c, F5, m3, m4, p1, p2, e6 → perm[new]=old
  const perm = buildSwapPermutation(
    7,
    { kind: 'pair', indices: [1, 2] },
    { kind: 'full', indices: [5] },
  );
  assert.deepEqual(perm, [0, 5, 3, 4, 1, 2, 6]);
  // 双射
  assert.deepEqual([...perm!].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6]);
  // 方向无关:a/b 互换结果一致
  assert.deepEqual(
    buildSwapPermutation(7, { kind: 'full', indices: [5] }, { kind: 'pair', indices: [1, 2] }),
    perm,
  );
});

test('buildSwapPermutation:交换后配对贪心扫描下,中间 pair 依旧相邻', () => {
  // 用真实 buildSpreads 验证结构学依据,不只信手推。
  const perm = buildSwapPermutation(
    7,
    { kind: 'pair', indices: [1, 2] },
    { kind: 'full', indices: [5] },
  )!;
  const next = perm.map((oldIdx, newIdx) => ({ ...BOOK[oldIdx]!, pageIndex: newIdx }));
  // 交换后书:c, F, m3, m4, p1, p2, e —— m3/m4 必须还配成一对,p1/p2 也是。
  assert.deepEqual(buildSpreads(next), [
    { kind: 'pair', left: null, right: 0 },
    { kind: 'full', page: 1 },
    { kind: 'pair', left: 2, right: 3 },
    { kind: 'pair', left: 4, right: 5 },
    { kind: 'pair', left: 6, right: null },
  ]);
});

test('buildSwapPermutation:非法组合返回 null', () => {
  assert.equal(
    buildSwapPermutation(7, { kind: 'single', indices: [1] }, { kind: 'full', indices: [5] }),
    null,
  );
});
