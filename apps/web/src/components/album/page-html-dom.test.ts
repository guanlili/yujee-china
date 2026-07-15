import assert from 'node:assert/strict';
import test from 'node:test';
import { applyFolioOverlay, pageFolioNumbers, patchHtmlImagePos, patchHtmlText, patchHtmlTextStyle, resolveDisplayHtml } from './page-html-dom';

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

// ── 手工编辑固化进 html 真相的两个 patcher ─────────────────────────────────────
// C 方案:页面真相 = html。编辑器此前只改画出来的 DOM + textsJson,html 不动 ——
// 重绘/刷新回退,AI 和导出读到旧内容。这两个 patcher 是客户端(本地即时同步)与
// albumService.updatePage(落库)共用的唯一实现,行为在此钉死。

test('patchHtmlTextStyle:覆写行内 style,保留既有其它声明', () => {
  const html = '<div data-text-key="title" style="font-size:36px;color:#111">HI</div>';
  const out = patchHtmlTextStyle(html, 'title', { 'font-size': '48px', 'font-weight': '700' });
  assert.ok(out);
  assert.match(out, /font-size:48px/);
  assert.match(out, /font-weight:700/);
  assert.match(out, /color:#111/, '未涉及的声明不能丢');
});

test('patchHtmlTextStyle:value=null 移除属性;bracket 槽 id 可寻址', () => {
  const html = '<p data-text-key="explain[0]" style="font-weight:700;font-size:13px">x</p>';
  const out = patchHtmlTextStyle(html, 'explain[0]', { 'font-weight': null });
  assert.ok(out);
  assert.doesNotMatch(out, /font-weight/);
  assert.match(out, /font-size:13px/);
});

test('patchHtmlTextStyle:注入被拒(返回 null,不产出损坏的 html)', () => {
  const html = '<div data-text-key="title" style="color:#111">HI</div>';
  assert.equal(patchHtmlTextStyle(html, 'title', { color: 'red;} <script>' }), null);
  assert.equal(patchHtmlTextStyle(html, 'title', { 'font-size"': '12px' }), null);
});

test("patchHtmlTextStyle:font-family 栈里的单引号放行('Segoe UI' 这类多词字体名)", () => {
  const html = '<div data-text-key="body" style="font-size:14px">x</div>';
  const out = patchHtmlTextStyle(html, 'body', {
    'font-family': "system-ui, -apple-system, 'Segoe UI', sans-serif",
  });
  assert.ok(out);
  assert.match(out, /'Segoe UI'/);
});

test('patchHtmlImagePos:与编辑器 applyLiveImagePos 的 CSS 逐字一致', () => {
  const html =
    '<img data-image-slot="image" src="{{IMG_SRC:image}}" style="object-fit:cover;object-position:50% 50%" />';
  const out = patchHtmlImagePos(html, 'image', { x: 30, y: 70, scale: 1.4 });
  assert.ok(out);
  assert.match(out, /object-position:30% 70%/);
  assert.match(out, /transform:scale\(1\.4\)/);
  assert.match(out, /transform-origin:30% 70%/);
  assert.match(out, /object-fit:cover/, '未涉及声明保留');
  assert.match(out, /\{\{IMG_SRC:image\}\}/, 'IMG_SRC token 必须原样保留(显示时才解析)');

  // scale 回到 1 → transform/origin 移除
  const back = patchHtmlImagePos(out, 'image', { x: 50, y: 50, scale: 1 });
  assert.ok(back);
  assert.doesNotMatch(back, /transform/);
});

test('patchHtml*:槽位不存在返回 null(调用方回退整页重烘)', () => {
  assert.equal(patchHtmlTextStyle('<div>x</div>', 'nope', { color: '#000' }), null);
  assert.equal(patchHtmlImagePos('<div>x</div>', 'nope', { x: 50, y: 50, scale: 1 }), null);
});
