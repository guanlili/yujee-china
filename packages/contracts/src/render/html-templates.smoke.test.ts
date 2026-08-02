// 参数化冒烟:registry 里每个 HTML 模板,用模板 JSON 的 sample 填一遍,断言
// 无残留 token、锚点齐全、体积达标。M2 每注册一个模板自动纳入覆盖。
import assert from 'node:assert/strict';
import test from 'node:test';

import { ITEMS_GRID_CAPACITY, TEMPLATES } from '../templates';
import { renderPageHtml } from './fill-template';
import { getHtmlTemplate } from './html-templates/registry';
import { lintTemplateHtml } from './html-template-lint';

const registered = Object.values(TEMPLATES).filter((tpl) => getHtmlTemplate(tpl.id));

test('registry 非空(至少 mag-01)', () => {
  assert.ok(registered.length >= 1);
});

for (const tpl of registered) {
  test(`HTML 模板 ${tpl.id}:锚点齐全 + sample 填充无残留 token`, () => {
    const html = getHtmlTemplate(tpl.id)!;
    assert.deepEqual(lintTemplateHtml(tpl, html), []);

    const texts: Record<string, string> = {};
    for (const slot of tpl.texts) texts[slot.id] = slot.sample ?? `示例${slot.id}`;
    const images: Record<string, string> = {};
    for (const slot of tpl.images) images[slot.id] = `photo-${slot.id}`;
    // items 栅格模板(如 mag-10)的图槽是 image[0..N] bracket 路径,不填的话空槽会按
    // 契约保留 token(显示层渲成缺图占位),这里是「填满无残留」冒烟,所以要填齐。
    const gridImage = tpl.items?.images?.[0];
    const gridSlots: string[] = [];
    if (gridImage) {
      for (let i = 0; i < ITEMS_GRID_CAPACITY; i += 1) gridSlots.push(`${gridImage.id}[${i}]`);
      for (const slotKey of gridSlots) images[slotKey] = `photo-${slotKey}`;
    }

    const filled = renderPageHtml(
      { templateId: tpl.id, images, texts },
      (photoId) => `resolved://${photoId}`,
    );
    assert.ok(filled, `${tpl.id} 填充失败`);
    assert.equal(/\{\{(TEXT|COLOR|FONT|IMG_SRC|IMG_POS|IMG_TF|FIT_SIZE):/.test(filled!), false, '有残留 token');
    assert.ok(filled!.includes(`data-template="${tpl.id}"`));
    assert.ok(filled!.length < 65536, '填充后超 64KB');
    for (const slot of tpl.images) {
      assert.ok(filled!.includes(`resolved://photo-${slot.id}`), `图槽 ${slot.id} src 未解析`);
    }
    for (const slotKey of gridSlots) {
      assert.ok(filled!.includes(`resolved://photo-${slotKey}`), `栅格图槽 ${slotKey} src 未解析`);
    }
  });
}
