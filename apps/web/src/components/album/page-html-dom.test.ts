import assert from 'node:assert/strict';
import test from 'node:test';
import { applyFolioOverlay, pageFolioNumbers, patchHtmlText, resolveDisplayHtml } from './page-html-dom';

test('pageFolioNumbers:内页从 1 连续编号,封面/封尾/目录为 null', () => {
  // p01=cover, mag-05/mag-06=interior, mag-02=toc, mag-20=ending
  assert.deepEqual(pageFolioNumbers(['p01', 'mag-05', 'mag-02', 'mag-06', 'mag-20']), [null, 1, null, 2, null]);
});

test('applyFolioOverlay:隐藏遗留 folio 槽 + 注入右下角页码', () => {
  const html = `<div data-template="mag-05"><p data-text-key="folio" style="color:#000">05</p><h1 data-text-key="title">T</h1></div>`;
  const out = applyFolioOverlay(html, 3);
  assert.ok(out.includes('data-text-key="folio" style="display:none;color:#000"'), '遗留 folio 未隐藏');
  assert.ok(out.includes('data-page-folio="true"'));
  assert.match(out, />3<\/div><\/div>$/);
  // 标题锚点不受影响
  assert.ok(out.includes('<h1 data-text-key="title">T</h1>'));
});

test('applyFolioOverlay:folio=null(封面/封尾)只隐藏不注入', () => {
  const html = `<div data-template="p01"><span data-text-key="folio">01</span></div>`;
  const out = applyFolioOverlay(html, null);
  assert.ok(out.includes('display:none'));
  assert.equal(out.includes('data-page-folio'), false);
});

test('applyFolioOverlay:无 style 属性的 folio 元素也能隐藏', () => {
  const html = `<div data-template="mag-06"><p data-text-key="folio">06</p></div>`;
  const out = applyFolioOverlay(html, 1);
  assert.ok(out.includes('data-text-key="folio" style="display:none"'));
});

test('既有能力回归:resolveDisplayHtml / patchHtmlText 不受影响', () => {
  const html = `<div data-template="mag-01"><img data-image-slot="image" src="{{IMG_SRC:image}}"/><h1 data-text-key="title">旧</h1></div>`;
  assert.ok(resolveDisplayHtml(html, { image: 'p1' }, () => 'blob:x').includes('src="blob:x"'));
  assert.ok(patchHtmlText(html, 'title', '新')!.includes('>新</h1>'));
});
