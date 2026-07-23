import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import * as React from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// 组件按 Next 的 automatic JSX runtime 写(不 import React);tsx 用 classic 转换,
// 编译产物引用全局 React —— 与 mag-02-toc-render.test.ts 同一处置。
(globalThis as { React?: typeof React }).React = React;

import { MobileEditor } from './MobileEditor';
import type { EditorPage } from '../../types';

const here = dirname(fileURLToPath(import.meta.url));
const source = (f: string) => readFileSync(join(here, f), 'utf8');

function page(templateId: string): EditorPage {
  return { pageIndex: 0, templateId, imagesJson: {}, textsJson: {} };
}
const BOOK: EditorPage[] = [
  page('mag-01'),
  ...Array.from({ length: 6 }, () => page('mag-03')),
  page('mag-20'),
];

function render(pages = BOOK) {
  return renderToStaticMarkup(
    createElement(MobileEditor, { pages, resolve: () => undefined, title: '厦门三日游' }),
  );
}

test('首帧就有完整骨架:顶栏 / 画板 / dock,默认密度 2(对页)', () => {
  const html = render();
  assert.match(html, /class="mobile-editor" data-density="2"/);
  assert.match(html, /class="mtopbar"/);
  assert.match(html, /class="mboard"/);
  assert.match(html, /class="mdock"/);
  assert.match(html, /厦门三日游/);
});

test('位置条显示「当前页 / 总页数」', () => {
  assert.match(render(), /1 \/ 8/);
});

test('空书不炸:不渲染任何开页,页码留空', () => {
  const html = render([]);
  assert.doesNotMatch(html, /class="mspread"/);
  assert.match(html, /class="mfolio"><\/span>/);
});

test('默认密度 2 渲染一个开页;封面是独页(只有一页,没有对开的空白半边)', () => {
  const html = render();
  const spreads = html.match(/class="mspread"/g) ?? [];
  assert.equal(spreads.length, 1, '密度 2 = 一屏一个开页');
  // 游标在页 0(封面)→ 独页 → 该开页里只有一个 .mpage
  const pagesInScreen = html.match(/class="mpage"/g) ?? [];
  assert.equal(pagesInScreen.length, 1, '封面独页不该带一个空白对开半边');
  assert.match(html, /data-solo="1"/);
});

/* ── 架构守卫:这两条是本次重构的存在理由,破了就等于回到老路 ────────────────── */

test('架构守卫:移动端这棵树不碰任何桌面 DOM(无 document/querySelector/innerHTML 拼装)', () => {
  const src = source('MobileEditor.tsx');
  assert.doesNotMatch(src, /\bdocument\./, '不许直接摸 document —— 节点归 React 所有');
  assert.doesNotMatch(src, /querySelector/, '不许去桌面树上找节点');
  assert.doesNotMatch(src, /createElement\(['"]/, '不许手搓 DOM 贴到别人的树上');
  assert.doesNotMatch(src, /#ovGrid|ov-page|ov-spread/, '不许依赖桌面画布的 DOM 契约');
});

test('架构守卫:移动端样式里没有媒体查询(这棵树只在手机上挂)', () => {
  // 先剥注释:本文件的抬头注释里就写着旧实现的 @media(max-width:767px),那是说明不是代码。
  const css = source('mobile-editor.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(
    css,
    /@media[^{]*max-width/,
    '有媒体查询就说明又在拿一套样式掰两种形态 —— 那正是要拆掉的东西',
  );
});
