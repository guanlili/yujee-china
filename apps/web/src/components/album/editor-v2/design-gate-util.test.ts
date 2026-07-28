import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { TEMPLATES } from '@yujee/contracts';

import {
  isDesigned,
  shouldMountLegacyMobileEditor,
  shouldMountMobileEditor,
} from './design-gate-util';

const HERE = dirname(fileURLToPath(import.meta.url));
const page = (templateId: string) => ({ templateId });

// 真实模板 id,不写死假值:cover 4 个(mag-01/23/32/p01)、ending 2 个、interior 40 个。
const COVER_IDS = Object.values(TEMPLATES).filter((t) => t.category === 'cover').map((t) => t.id);
const INTERIOR_IDS = Object.values(TEMPLATES).filter((t) => t.category === 'interior').map((t) => t.id);
const ENDING_IDS = Object.values(TEMPLATES).filter((t) => t.category === 'ending').map((t) => t.id);

test('前提:契约里确实有 cover / interior / ending 三类模板', () => {
  assert.ok(COVER_IDS.length > 0, '没有 cover 模板,判据不成立');
  assert.ok(INTERIOR_IDS.length > 0);
  assert.ok(ENDING_IDS.length > 0);
});

test('isDesigned:排版完但没选封面(全是内页) → false', () => {
  const pages = INTERIOR_IDS.slice(0, 5).map(page);
  assert.equal(isDesigned(pages), false);
});

test('isDesigned:每一个 cover 模板都要认得出来', () => {
  for (const id of COVER_IDS) {
    assert.equal(isDesigned([page(id), ...INTERIOR_IDS.slice(0, 3).map(page)]), true, `${id} 没被认作封面`);
  }
});

test('isDesigned:只有封尾页不算已设计(ending ≠ cover)', () => {
  assert.equal(isDesigned([...INTERIOR_IDS.slice(0, 3).map(page), page(ENDING_IDS[0]!)]), false);
});

test('isDesigned:空书 / 未知模板 id 不炸也不误判', () => {
  assert.equal(isDesigned([]), false);
  assert.equal(isDesigned([page('no-such-template')]), false);
});

test('shouldMountMobileEditor:手机 + 有页 + 已选封面 → 接管画板', () => {
  const designed = [page(COVER_IDS[0]!), ...INTERIOR_IDS.slice(0, 4).map(page)];
  assert.equal(shouldMountMobileEditor('mobile', designed), true);
});

test('shouldMountMobileEditor:手机 + 有页 + 未选封面 → 留在对话框选主题(本次修的就是它)', () => {
  const undesigned = INTERIOR_IDS.slice(0, 5).map(page);
  assert.equal(
    shouldMountMobileEditor('mobile', undesigned),
    false,
    '排版完就抢先进画板 → ChatPanel 的必选封面卡再也弹不出来,手机上没法选主题',
  );
});

test('shouldMountMobileEditor:没有页面(还在收集故事) → 不接管', () => {
  assert.equal(shouldMountMobileEditor('mobile', []), false);
});

test('shouldMountMobileEditor:桌面视口一律不接管,不受封面状态影响', () => {
  const designed = [page(COVER_IDS[0]!), ...INTERIOR_IDS.slice(0, 3).map(page)];
  assert.equal(shouldMountMobileEditor('desktop', designed), false);
  assert.equal(shouldMountMobileEditor('desktop', INTERIOR_IDS.slice(0, 3).map(page)), false);
});

test('legacy finalized albums keep their existing mobile pages-only routing', () => {
  const interiorOnly = INTERIOR_IDS.slice(0, 2).map(page);
  assert.equal(shouldMountLegacyMobileEditor('mobile', interiorOnly), true);
  assert.equal(shouldMountLegacyMobileEditor('desktop', interiorOnly), false);
  assert.equal(shouldMountLegacyMobileEditor('mobile', []), false);
});

test('EditorPort:分流必须走 shouldMountMobileEditor,不许退回只看 pages.length(回归)', () => {
  const src = readFileSync(join(HERE, 'EditorPort.tsx'), 'utf8');
  assert.match(src, /shouldMountMobileEditor/, '分流要用统一判据');
  assert.doesNotMatch(
    src,
    /device === 'mobile' && pages\.length > 0\)/,
    '不许保留「只看 pages.length」的旧分流 —— 那会跳过选封面主题这一步',
  );
});
