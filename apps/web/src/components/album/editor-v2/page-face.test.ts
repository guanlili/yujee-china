import assert from 'node:assert/strict';
import { test } from 'node:test';

import { pageFaceInner, pageFaceHTML, type PageFaceCtx } from './page-face';
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
