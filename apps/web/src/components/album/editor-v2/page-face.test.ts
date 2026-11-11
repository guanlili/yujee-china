import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { pageFaceInner, pageFaceHTML, toHtmlPage, type PageFaceCtx } from './page-face';
import type { EditorPage } from '../types';
import { PAGE } from '../templates/constants';

/* ════════════════════════════════════════════════════════════════════════════
   page-face —— 「一页书长什么样」的共享渲染层(移动/桌面两棵 UI 树都用它)。
   这组断言是从 EditorPort 的 faceInner/faceHTML 原地抽出前写的**行为快照**:
   抽取属于纯搬家,任何一条变红都说明搬歪了。
   ════════════════════════════════════════════════════════════════════════════ */

const resolve = (id: string) => `blob:${id}`;

function ctx(over: Partial<PageFaceCtx> = {}): PageFaceCtx {
  return { folio: null, folioSide: 'right', total: 24, resolve, ...over };
}

// 真实页面 html 是 div 根(模板产出如此),folio 浮层正是插在最后一个 </div> 之前。
function htmlPage(inner = '<section id="truth">hi</section>'): EditorPage {
  return {
    pageIndex: 3,
    templateId: 'mag-01-p1',
    imagesJson: {},
    textsJson: {},
    htmlJson: `<div class="page">${inner}</div>`,
  };
}

test('pageFaceInner: 没有页面 → 空串(不是 undefined,调用方直接塞 innerHTML)', () => {
  assert.equal(pageFaceInner(null, ctx()), '');
});

test('pageFaceInner: 存库 html 是页面真相,原样透出(经 folio overlay)', () => {
  const out = pageFaceInner(htmlPage(), ctx());
  assert.match(out, /<section id="truth">hi<\/section>/);
});

test('pageFaceInner: folio 有值 → 贴页码浮层;为 null → 不贴', () => {
  const page = htmlPage();
  const withFolio = pageFaceInner(page, ctx({ folio: 7 }));
  assert.match(withFolio, /data-page-folio="true"/, 'folio 有值时必须贴页码');
  assert.match(withFolio, /7/);

  const withoutFolio = pageFaceInner(page, ctx({ folio: null }));
  assert.doesNotMatch(withoutFolio, /data-page-folio="true"/, 'folio 为 null 时不贴页码');
});

test('pageFaceInner: 页码贴该页外侧下角 —— 左页靠左,右页靠右', () => {
  const page = htmlPage();
  assert.match(pageFaceInner(page, ctx({ folio: 7, folioSide: 'left' })), /left:36px/);
  assert.match(pageFaceInner(page, ctx({ folio: 7, folioSide: 'right' })), /right:36px/);
});

test('pageFaceInner: 无 html 且模板不认识 → 明示 Unknown template,不静默空白', () => {
  const page: EditorPage = {
    pageIndex: 0,
    templateId: 'no-such-template',
    imagesJson: {},
    textsJson: {},
  };
  assert.match(pageFaceInner(page, ctx()), /Unknown template: no-such-template/);
});

test('pageFaceHTML: 794×1123 页按盒子等比缩放填充,scale 取宽高较小者', () => {
  const page = htmlPage();
  // 宽给一半、高给足 → 受宽限制
  const out = pageFaceHTML(page, PAGE.width / 2, PAGE.height, ctx());
  assert.match(out, /transform:scale\(0\.5\)/);
  assert.match(out, /transform-origin:top left/);
  // 内层永远是原始页尺寸,缩放靠 transform;外层是盒子尺寸 + 裁剪
  assert.match(out, new RegExp(`width:${PAGE.width}px;height:${PAGE.height}px`));
  assert.match(out, new RegExp(`width:${PAGE.width / 2}px;height:${PAGE.height}px;overflow:hidden`));
});

test('pageFaceHTML: 盒子为 0 时 scale 兜底为 1,不产出 scale(0) 或 NaN', () => {
  const out = pageFaceHTML(htmlPage(), 0, 0, ctx());
  assert.match(out, /transform:scale\(1\)/);
  assert.doesNotMatch(out, /NaN/);
});

test('pageFaceHTML: 没有页面时外框仍在(占位不塌),内容为空', () => {
  const out = pageFaceHTML(null, 100, 200, ctx());
  assert.match(out, /width:100px;height:200px/);
  assert.match(out, /<\/div><\/div>$/);
});

/* ════════════════════════════════════════════════════════════════════════════
   单一来源(#330):「一页书长什么样」只允许有一个定义。

   历史:栅格 PDF 导出曾经自己抄了一份等价的 renderFaceHtml(与 pageFaceInner
   同一套 helper,只差包装)。两份并存的风险不是「现在就不同」,而是**以后改一边**:
   改 folio 规则、改旋转槽补丁、改缺图占位时,只改屏显那一份,导出的书就和屏幕
   不一样了 —— 而这类偏差只在用户把 PDF 拿去印刷时才被发现。
   ════════════════════════════════════════════════════════════════════════════ */

test('导出侧的字段形态与屏显侧的 EditorPage 形态产出逐字相同', () => {
  // 导出(render-raster)喂的是 AdaptablePage(html/images/texts/imagePos),
  // 屏显喂的是 EditorPage(htmlJson/imagesJson/textsJson/imagePosJson)。
  // 同一个页面两种形态必须给出同一份 HTML —— 这正是「导出的书 = 屏幕上的书」。
  const editor = htmlPage();
  const adaptable = toHtmlPage({
    templateId: editor.templateId,
    images: editor.imagesJson,
    texts: editor.textsJson,
    html: editor.htmlJson,
  });
  assert.equal(pageFaceInner(adaptable, ctx({ folio: 7 })), pageFaceInner(editor, ctx({ folio: 7 })));
});

test('render-raster 必须调 pageFaceInner,不许再抄第二份页面渲染', () => {
  const raster = readFileSync(new URL('../../../lib/pdf/render-raster.ts', import.meta.url), 'utf8');
  assert.match(raster, /pageFaceInner\(toHtmlPage\(page\)/, '导出的页面渲染必须走共享层');
  assert.doesNotMatch(raster, /function renderFaceHtml/, '不许再抄一份等价的页面渲染(改一边就两端不一致)');
  assert.doesNotMatch(raster, /renderPageHtml\(/, '模板即时渲染只应在 page-html-dom / page-face 里调');
});
