// 槽元素嵌套定位的 lint(2026-08-22)。
//
// 由来:mag-09 把 body/explain/explain2 三个绝对定位的 <p> 套进了另一个绝对定位的
// 外层 div,而它们自己写的是**整页坐标** —— 浏览器把两层坐标叠加,body 落到 x=1008、
// explain2 落到 y=1284,在 794×1123 的页面上等于不存在。屏幕、导出 PDF、Live 视频
// 全都少这三段字(导出图取证:标题下方空白,右上角一大片空)。
//
// 模板里的坐标一律是整页坐标,这是全库 51 个模板的共同写法,也是工作台
// /api/dev/template-box 直接改 left/top 的前提。所以规则是:槽元素与模板根之间
// 不允许再有定位祖先。
import assert from 'node:assert/strict';
import test from 'node:test';

import { TEMPLATES, type TemplateDef } from '../templates';
import { getHtmlTemplate } from './html-templates/registry';
import { lintTemplateHtml } from './html-template-lint';

const NESTED_TPL: TemplateDef = {
  id: 'fake-01',
  category: 'interior',
  images: [],
  texts: [{ id: 'title', role: 'title', lang: 'user' }],
};

test('嵌在定位外层里的绝对定位槽会被 lint 拦下', () => {
  const html =
    '<div data-template="fake-01" style="position:relative;width:794px;height:1123px">' +
    '<div style="position:absolute;left:60px;top:620px;width:280px">' +
    '<p data-text-key="title" style="position:absolute;left:60px;top:620px">{{TEXT:title}}</p>' +
    '</div></div>';
  const errors = lintTemplateHtml(NESTED_TPL, html);
  assert.equal(errors.length, 1, `期望 1 条嵌套报错,实际:${JSON.stringify(errors)}`);
  assert.match(errors[0]!, /title/);
  assert.match(errors[0]!, /定位/);
});

test('槽直接挂在模板根下不报错', () => {
  const html =
    '<div data-template="fake-01" style="position:relative;width:794px;height:1123px">' +
    '<p data-text-key="title" style="position:absolute;left:60px;top:620px">{{TEXT:title}}</p>' +
    '</div>';
  assert.deepEqual(lintTemplateHtml(NESTED_TPL, html), []);
});

test('非定位的外层(纯分组 div)不算嵌套', () => {
  const html =
    '<div data-template="fake-01" style="position:relative;width:794px;height:1123px">' +
    '<div style="width:280px">' +
    '<p data-text-key="title" style="position:absolute;left:60px;top:620px">{{TEXT:title}}</p>' +
    '</div></div>';
  assert.deepEqual(lintTemplateHtml(NESTED_TPL, html), []);
});

test('图槽 <img> 嵌在自己的图框里不算(那是契约要求的双层锚点)', () => {
  const tpl: TemplateDef = {
    id: 'fake-02',
    category: 'interior',
    images: [{ id: 'image' }],
    texts: [],
  };
  const html =
    '<div data-template="fake-02" style="position:relative;width:794px;height:1123px">' +
    '<div data-image-slot="image" style="position:absolute;left:0;top:0;width:300px;height:300px;overflow:hidden">' +
    '<img data-image-slot="image" src="{{IMG_SRC:image}}" style="width:100%;height:100%" /></div></div>';
  assert.deepEqual(lintTemplateHtml(tpl, html), []);
});

// 回归:这两个模板原本就是嵌套写法,mag-09 因此丢了三段字。
for (const id of ['mag-07', 'mag-09']) {
  test(`${id}:槽不嵌在定位外层里(坐标不叠加)`, () => {
    assert.deepEqual(lintTemplateHtml(TEMPLATES[id]!, getHtmlTemplate(id)!), []);
  });
}
