import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getTemplate } from '@yujee/contracts/templates';
import { coverOptionImages } from './cover-option-slots';

const slotsOf = (templateId: string) => (getTemplate(templateId)?.images ?? []).map((s) => s.id);

test('封底 mag-22 的两个图槽都填上 —— 这是「选择卡封底少一张照片」的修复点', () => {
  // 修之前 coverOptionHTML 只填 heroSlotId(= 第一个槽),mag-22 的 image2 永远是空的。
  // 第 1/2/4 套封底都是 mag-22,所以线上三套的封底预览都缺一张图。
  assert.deepEqual(slotsOf('mag-22'), ['image1', 'image2'], '前提:mag-22 是两个图槽');
  assert.deepEqual(coverOptionImages('mag-22', 'p1'), { image1: 'p1', image2: 'p1' });
});

test('单图槽模板照旧只填一个', () => {
  for (const id of ['mag-01', 'mag-23', 'mag-62', 'p01']) {
    const slots = slotsOf(id);
    assert.equal(slots.length, 1, `前提:${id} 是单图槽`);
    assert.deepEqual(coverOptionImages(id, 'p1'), { [slots[0]!]: 'p1' });
  }
});

test('零图槽的 mag-63 不凭空造槽', () => {
  assert.deepEqual(slotsOf('mag-63'), [], '前提:mag-63 是纯装饰封底');
  assert.deepEqual(coverOptionImages('mag-63', 'p1'), {});
});

test('没有照片时返回空表(渲模板 sample,不塞空 src)', () => {
  assert.deepEqual(coverOptionImages('mag-22', null), {});
});

test('认不出的模板不炸,返回空表', () => {
  assert.deepEqual(coverOptionImages('not-a-template', 'p1'), {});
});
