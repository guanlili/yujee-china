import assert from 'node:assert/strict';
import test from 'node:test';
import { bakePagesHtml } from './bake-html';

// C 方案:排版/设计落库前,把每页烘成 HTML(页面真相)。
// 图片 src 保持 {{IMG_SRC:slotId}} token 原样 —— base64 绝不落库。

const PAGE = {
  pageIndex: 0,
  templateId: 'mag-01',
  images: { image: 'photo-real-id' },
  texts: { title: '夏日海岸', label: 'SUMMER', explain1: '一段说明', explain2: '另一段' },
};

test('bakePagesHtml 给每页写入烘干的 html(文字入体,src 保持 token)', () => {
  const [page] = bakePagesHtml([PAGE]);
  assert.ok(page.html, 'html 缺失');
  assert.ok(page.html!.includes('data-template="mag-01"'));
  assert.ok(page.html!.includes('夏日海岸'), '文字未烘入');
  assert.ok(page.html!.includes('{{IMG_SRC:image}}'), '图片 src 必须保持 token');
  assert.equal(page.html!.includes('photo-real-id'), false, 'photoId 不得出现在 html');
  // 原槽位字段原样保留(templateId/images 仍是重生成与照片引用的依据)
  assert.equal(page.templateId, 'mag-01');
  assert.deepEqual(page.images, { image: 'photo-real-id' });
});

test('bakePagesHtml 已有 html 的页不重烘(编辑器/AI 的手工改动不被覆盖)', () => {
  const custom = '<div data-template="mag-01">CUSTOM</div>';
  const [page] = bakePagesHtml([{ ...PAGE, html: custom }]);
  assert.equal(page.html, custom);
});

test('bakePagesHtml 无 HTML 模板的 templateId 抛错(M2 全量后不应发生)', () => {
  assert.throws(() => bakePagesHtml([{ ...PAGE, templateId: 'mag-does-not-exist' }]), /HTML 模板/);
});

test('lenient 模式:未注册模板跳过不抛(迁移过渡期)', () => {
  const [page] = bakePagesHtml([{ ...PAGE, templateId: 'mag-does-not-exist' }], { strict: false });
  assert.equal(page.html, undefined);
});
