import assert from 'node:assert/strict';
import test from 'node:test';
import { applyFolioOverlay, patchHtmlImagePos, patchHtmlPageStyle, patchHtmlText, patchHtmlTextStyle, resolveDisplayHtml } from './page-html-dom';

// pageFolioNumbers/pageFolioSides 的覆盖(内页编号、左右贴边、目录错位)已随 #303
// 合并进 pageFolioInfos,搬去 page-folio.test.ts;这里只留 applyFolioOverlay 本身
// 的回归(单页签名 = PageFolio 的 number 分支,字节级不变)。

test('applyFolioOverlay:右页(side=right)页码贴右下角', () => {
  const html = `<div data-template="mag-06"><h1 data-text-key="title">T</h1></div>`;
  const out = applyFolioOverlay(html, 2, 'right');
  assert.ok(out.includes('right:36px'), '未贴右下角');
  assert.equal(out.includes('left:36px'), false);
});

test('applyFolioOverlay:左页(side=left)页码贴左下角', () => {
  const html = `<div data-template="mag-05"><h1 data-text-key="title">T</h1></div>`;
  const out = applyFolioOverlay(html, 1, 'left');
  assert.ok(out.includes('left:36px'), '未贴左下角');
  assert.equal(out.includes('right:36px'), false);
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

test('patchHtmlTextStyle:写入真实字体栈(双引号)必须成功,不能被注入护栏当非法值拒掉(回归)', () => {
  // WEB_FONTS 里每条字体栈都是双引号形态(constants.ts:
  // serifCn = '"Noto Serif SC", "Source Han Serif SC", "Songti SC", serif'),
  // 而护栏曾禁双引号 → 选字体时 patcher 返回 null → 调用方把 htmlJson 置 undefined
  // → 那一页回落「模板+数据」重烘,**改动不上屏**;更糟的是这一页 html 真相已丢,
  // 之后改颜色/字号也一并预览不出来(表现为「颜色、字体全都不可用」)。
  const html = '<div data-text-key="title" style="color:#1c1b18">HI</div>';
  const stack = '"Noto Serif SC", "Source Han Serif SC", "Songti SC", serif';
  const out = patchHtmlTextStyle(html, 'title', { 'font-family': stack });
  assert.ok(out, '真实字体栈不能被拒(返回 null 会让整页 html 真相丢掉)');
  // 写进 style="" 属性里必须是实体形态,否则裸 " 会截断属性、毁掉标签结构。
  assert.equal(out.includes('font-family:"'), false, '裸双引号会截断 style 属性');
  assert.match(out, /font-family:&quot;Noto Serif SC&quot;, &quot;Source Han Serif SC&quot;/);
  assert.match(out, /color:#1c1b18/, '原有声明保留');
  // 存库形态可被自己读回:再打一次补丁,字体栈仍完整(不被 split 切碎)。
  const again = patchHtmlTextStyle(out, 'title', { color: '#13b8a6' });
  assert.ok(again);
  assert.match(again, /font-family:&quot;Noto Serif SC&quot;/, '二次打补丁不能损坏字体栈');
});

test('patchHtmlTextStyle:含双引号的值转义后无法逃出 style 属性(放行双引号的安全前提)', () => {
  const html = '<div data-text-key="title" style="color:#1c1b18">HI</div>';
  // 双引号一律实体化,所以「闭合属性再挂事件处理器」这条路走不通:落地的是
  // onload=&quot; 这样的纯文本,不是真属性。拒绝反而会丢掉整页 html 真相(本 bug 的成因)。
  const out = patchHtmlTextStyle(html, 'title', { 'font-family': 'a" onload="x' });
  assert.ok(out, '不该整页放弃');
  assert.equal(/\sonload="/.test(out), false, '不能生成真的 onload 属性');
  assert.match(out, /font-family:a&quot; onload=&quot;x/);
  // 标签仍只有一个 style 属性,结构没被撑开。
  assert.equal((out.match(/style="/g) ?? []).length, 1);

  // 带尖括号/分号/花括号的仍旧拒绝:它们能开标签或截断 CSS 声明,不是转义能兜住的。
  assert.equal(patchHtmlTextStyle(html, 'title', { 'font-family': 'a"><script>y' }), null);
  assert.equal(patchHtmlTextStyle(html, 'title', { color: 'red;} <b>' }), null);
  assert.equal(patchHtmlTextStyle(html, 'title', { 'font-size"': '12px' }), null);
});

test('patchHtmlPageStyle:页根写入含双引号的值同样走实体转义', () => {
  const html = '<div data-template="mag-01" style="background:#fff">x</div>';
  const out = patchHtmlPageStyle(html, { 'font-family': '"Inter", sans-serif' });
  assert.ok(out);
  assert.equal(out.includes('font-family:"'), false);
  assert.match(out, /font-family:&quot;Inter&quot;, sans-serif/);
});

test('patchHtmlTextStyle:改样式不切碎已有 &quot; 转义的 font-family 字体栈(回归)', () => {
  // 存库 html 的 style 值里字体名的 " 转义成 HTML 实体 &quot;(末尾就是分号)。此前
  // upsertStyleAttr 用 split(';') 解析,会把字体栈从每个 &quot; 的分号处切碎、丢掉无冒号
  // 碎片 → font-family 损坏,表现为「改颜色/字体/字号都不保存」。
  const html = '<div data-text-key="title" style="color:#1c1b18;font-family:&quot;Playfair Display&quot;, &quot;Noto Serif SC&quot;, serif;width:460px">HI</div>';
  const out = patchHtmlTextStyle(html, 'title', { color: '#13b8a6' });
  assert.ok(out);
  assert.match(out, /color:#13b8a6/, '颜色已改');
  assert.match(out, /font-family:&quot;Playfair Display&quot;, &quot;Noto Serif SC&quot;, serif/, 'font-family 字体栈必须完整保留');
  assert.match(out, /width:460px/, '后续声明不能丢');
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

test('patchHtmlPageStyle:给页根 background-color 上色,叠在模板默认 background 之后取胜', () => {
  const html =
    '<div data-template="mag-05" style="position:relative;width:794px;height:1123px;background:#fff;color:#1c1b18">' +
    '<h1 data-text-key="title" style="color:#1c1b18">T</h1></div>';
  const out = patchHtmlPageStyle(html, { 'background-color': '#f2e9d8' });
  assert.ok(out);
  // background-color 排在 background:#fff 之后(源序靠后取胜)
  assert.match(out, /background:#fff;.*background-color:#f2e9d8/);
  // 只动页根,内部文字元素不受影响
  assert.match(out, /<h1 data-text-key="title" style="color:#1c1b18">/);
});

test('patchHtmlPageStyle:半透明 rgba 合法(透明度)', () => {
  const html = '<div data-template="mag-01" style="width:794px;height:1123px;background:#fff">x</div>';
  const out = patchHtmlPageStyle(html, { 'background-color': 'rgba(20, 30, 40, 0.4)' });
  assert.ok(out);
  assert.match(out, /background-color:rgba\(20, 30, 40, 0\.4\)/);
});

test('patchHtmlPageStyle:value=null 移除 background-color → 回落模板默认 background:#fff(无背景)', () => {
  const html = '<div data-template="mag-01" style="width:794px;height:1123px;background:#fff;background-color:#123456">x</div>';
  const out = patchHtmlPageStyle(html, { 'background-color': null });
  assert.ok(out);
  assert.doesNotMatch(out, /background-color/);
  assert.match(out, /background:#fff/);
});

test('patchHtml*:槽位不存在返回 null(调用方回退整页重烘)', () => {
  assert.equal(patchHtmlTextStyle('<div>x</div>', 'nope', { color: '#000' }), null);
  assert.equal(patchHtmlImagePos('<div>x</div>', 'nope', { x: 50, y: 50, scale: 1 }), null);
  // 页根无 data-template → 找不到锚点,返回 null(不产出损坏 html)
  assert.equal(patchHtmlPageStyle('<div style="background:#fff">x</div>', { 'background-color': '#000' }), null);
  // 注入护栏:非法值/属性名被拒
  assert.equal(patchHtmlPageStyle('<div data-template="m">x</div>', { 'background-color': '#000;} <x>' }), null);
});

// 本机没有这张照片时(换设备、清缓存,或 origin 变了 —— IndexedDB 按 origin 隔离,
// http://localhost:3000 与 https://localhost:3000 是两套库),resolveImage 返回
// undefined。此前填空串,产出 <img src="">:浏览器会把空 src 当成「拿当前页面地址
// 当图片」,必然失败 → 图槽显示成碎图标,还会原样印进导出的 PDF。
// 契约:解析不到就是「空图槽」,渲染上必须真的什么都不显示。
test('resolveDisplayHtml:解析不到照片时给出空图槽,不是 src="" 的碎图', () => {
  const html = '<div data-template="mag-01"><img data-image-slot="image" src="{{IMG_SRC:image}}"/></div>';

  const missing = resolveDisplayHtml(html, { image: 'p1' }, () => undefined);
  assert.equal(missing.includes('src=""'), false, '空 src 会被浏览器渲染成碎图标');
  assert.ok(/src="data:image\/(gif|png);base64,/.test(missing), '应回退到透明占位像素');

  // 槽位压根没配照片时,同样不能留空 src。
  const unslotted = resolveDisplayHtml(html, {}, () => 'blob:x');
  assert.equal(unslotted.includes('src=""'), false);
});
