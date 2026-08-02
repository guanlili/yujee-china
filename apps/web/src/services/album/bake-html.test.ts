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

test('烘焙保留旋转:imagePos.rotate 烘完补盒交换(fill-template 的 IMG_TF 够不到)', () => {
  // 整页重烘是 imagePos patch 失配时的兜底;重烘丢 rotate 的话,用户存过的旋转
  // 会在兜底后静默消失(2026-08-02 图片旋转)。
  const [page] = bakePagesHtml([
    { ...PAGE, imagePos: { image: { x: 40, y: 60, scale: 1.3, rotate: 90 } } },
  ]);
  assert.ok(page.html);
  assert.match(page.html!, /rotate\(90deg\)/, '旋转必须烘进 html');
  assert.match(page.html!, /translate\(-50%, -50%\)/, '盒交换居中锚');
  assert.ok(page.html!.includes('{{IMG_SRC:image}}'), '补旋转不动 src token');
  // 未旋转的页逐字节不变(applyImageRotatePatches 对无 rotate 槽是恒等)
  const [plain] = bakePagesHtml([{ ...PAGE, imagePos: { image: { x: 40, y: 60, scale: 1.3 } } }]);
  assert.doesNotMatch(plain.html!, /rotate\(/);
});
