import assert from 'node:assert/strict';
import test from 'node:test';

import { applyPageBackground } from './page-background';
import { renderPageHtml } from './fill-template';
import { PAGE_BACKGROUND_CARRIER_KEY } from '../theme-carrier';
import { TEMPLATES } from '../templates.generated';

const ROOT = '<div data-template="mag-05" style="position:relative;width:794px;background:#fff;color:#1c1b18">x</div>';

test('无底色时逐字节不变', () => {
  assert.equal(applyPageBackground(ROOT, undefined), ROOT);
  assert.equal(applyPageBackground(ROOT, ''), ROOT);
});

test('background-color 追加在 style 末尾（必须盖住 background:#fff 简写）', () => {
  const out = applyPageBackground(ROOT, '#F3F0A8');
  const style = /style="([^"]*)"/.exec(out)![1]!;
  assert.ok(style.endsWith('background-color:#F3F0A8'), `末尾不是新底色：${style}`);
  assert.ok(style.indexOf('background:#fff') < style.indexOf('background-color:'), '简写必须在前才盖得住');
});

test('页根没有 style 属性时补一个', () => {
  const bare = '<div data-template="mag-05">x</div>';
  assert.equal(applyPageBackground(bare, '#2D6DB0'), '<div data-template="mag-05" style="background-color:#2D6DB0">x</div>');
});

test('重复应用是幂等的（同一个键覆盖，不追加第二份）', () => {
  const once = applyPageBackground(ROOT, '#F3F0A8');
  const twice = applyPageBackground(once, '#F3F0A8');
  assert.equal(twice, once);
  const changed = applyPageBackground(once, '#2D6DB0');
  assert.equal((changed.match(/background-color:/g) ?? []).length, 1, '不能留下两个 background-color');
});

test('非法色值原样返回（拒绝比写坏安全）', () => {
  assert.equal(applyPageBackground(ROOT, 'red; content:url(x)'), ROOT);
  assert.equal(applyPageBackground(ROOT, 'rgb(1,2,3)'), ROOT);
});

test('找不到页根时原样返回', () => {
  assert.equal(applyPageBackground('<p>no root</p>', '#F3F0A8'), '<p>no root</p>');
});

function sample(templateId: string, extraTexts: Record<string, string> = {}) {
  const tpl = (TEMPLATES as Record<string, { texts?: { id: string; sample?: string }[]; images?: { id: string }[] }>)[templateId]!;
  const texts: Record<string, string> = {};
  for (const t of tpl.texts ?? []) texts[t.id] = t.sample ?? '';
  const images: Record<string, string> = {};
  for (const im of tpl.images ?? []) images[im.id] = `p-${im.id}`;
  return { templateId, images, texts: { ...texts, ...extraTexts } };
}

test('没有 #pageBackground 键时，renderPageHtml 输出逐字节不变', () => {
  for (const id of ['mag-05', 'mag-13', 'mag-01', 'mag-62']) {
    const before = renderPageHtml(sample(id), () => 'IMG');
    const after = renderPageHtml(sample(id, { unrelated: 'x' }), () => 'IMG');
    assert.ok(before, `${id} 渲染失败`);
    // 与本次改动前的行为对齐：无 carrier 键 → 页根不出现 background-color
    assert.ok(!/data-template="[^"]*"[^>]*background-color:/.test(before!), `${id} 页根多了 background-color`);
    assert.ok(after);
  }
});

test('有 #pageBackground 键时，页根末尾出现该底色', () => {
  const html = renderPageHtml(sample('mag-05', { [PAGE_BACKGROUND_CARRIER_KEY]: '#F3F0A8' }), () => 'IMG')!;
  const style = /data-template="mag-05"[^>]*style="([^"]*)"/.exec(html)![1]!;
  assert.ok(style.endsWith('background-color:#F3F0A8'), `末尾不是底色：${style}`);
});

test('#pageBackground 不会被当成文字槽渲进页面内容', () => {
  const html = renderPageHtml(sample('mag-05', { [PAGE_BACKGROUND_CARRIER_KEY]: '#F3F0A8' }), () => 'IMG')!;
  assert.ok(!html.includes('>#F3F0A8<'), 'carrier 值漏进了页面文字');
});
