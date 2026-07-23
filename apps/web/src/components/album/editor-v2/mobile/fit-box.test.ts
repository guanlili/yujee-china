import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fitBox, spreadAspect } from './fit-box';

/* 「一屏怎么摆」的几何:把开页按比例塞进可视区,不裁不拉伸。
   放在 JS 里算而不是交给 CSS aspect-ratio —— 两页并排/竖排两开页时,
   max-width 一夹比例就破了(页面被拉长),而页面是照片版面,拉伸即出事故。 */

test('fitBox: 区域比目标宽 → 受高度限制,左右留白', () => {
  const box = fitBox(1000, 100, 1); // 目标 1:1
  assert.deepEqual(box, { w: 100, h: 100 });
});

test('fitBox: 区域比目标高 → 受宽度限制,上下留白', () => {
  const box = fitBox(100, 1000, 1);
  assert.deepEqual(box, { w: 100, h: 100 });
});

test('fitBox: 永远不超出区域(两个方向都不溢出)', () => {
  for (const [aw, ah, r] of [[375, 600, 1.414], [812, 375, 0.707], [300, 300, 2]] as const) {
    const box = fitBox(aw, ah, r);
    assert.ok(box.w <= aw + 0.001, `宽溢出: ${box.w} > ${aw}`);
    assert.ok(box.h <= ah + 0.001, `高溢出: ${box.h} > ${ah}`);
    assert.ok(Math.abs(box.w / box.h - r) < 0.001, '比例必须保住,页面不许被拉伸');
  }
});

test('fitBox: 区域为 0 或负(首帧未量到)→ 归零,不产出 NaN/负尺寸', () => {
  assert.deepEqual(fitBox(0, 500, 1.4), { w: 0, h: 0 });
  assert.deepEqual(fitBox(-10, 500, 1.4), { w: 0, h: 0 });
});

test('spreadAspect: 单页是一页宽,对页是两页宽', () => {
  const single = spreadAspect(1);
  const paired = spreadAspect(2);
  assert.ok(Math.abs(paired / single - 2) < 0.001, '对页正好是单页的两倍宽');
  assert.ok(single < 1, '单页是竖的(794×1123)');
});
