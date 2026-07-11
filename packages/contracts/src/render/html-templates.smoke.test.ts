// 参数化冒烟:registry 里每个 HTML 模板,用模板 JSON 的 sample 填一遍,断言
// 无残留 token、锚点齐全、体积达标。M2 每注册一个模板自动纳入覆盖。
import assert from 'node:assert/strict';
import test from 'node:test';

import { TEMPLATES } from '../templates';
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

    const filled = renderPageHtml(
      { templateId: tpl.id, images, texts },
      (photoId) => `resolved://${photoId}`,
    );
    assert.ok(filled, `${tpl.id} 填充失败`);
    assert.equal(/\{\{(TEXT|COLOR|FONT|IMG_SRC|IMG_POS|IMG_TF):/.test(filled!), false, '有残留 token');
    assert.ok(filled!.includes(`data-template="${tpl.id}"`));
    assert.ok(filled!.length < 65536, '填充后超 64KB');
    for (const slot of tpl.images) {
      assert.ok(filled!.includes(`resolved://photo-${slot.id}`), `图槽 ${slot.id} src 未解析`);
    }
  });
}
