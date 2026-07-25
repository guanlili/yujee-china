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

const noop = () => {};

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

function render(pages = BOOK, zh = true) {
  return renderToStaticMarkup(
    createElement(MobileEditor, {
      pages,
      resolve: () => undefined,
      title: '厦门三日游',
      zh,
      // 编辑焦点由父层持有(见 MobileEditorRoot):浏览态 = null。
      editPage: null,
      onEnterEdit: noop, onExitEdit: noop,
      selection: null, sheetOpen: false,
      onSelectText: noop, onSelectImage: noop, onClearSelection: noop,
      onShare: noop, onExport: noop, onMore: noop, onBoardBg: noop, onOpenChat: noop,
      onPageBg: noop, onPickImage: noop, onPickText: noop, onDeletePage: noop,
    }),
  );
}

test('首帧就有完整骨架:顶栏 / 画板 / 书册预览栏,默认密度 2(对页)', () => {
  const html = render();
  assert.match(html, /data-mode="browse" data-density="2"/);
  assert.match(html, /class="mtopbar"/);
  assert.match(html, /class="mboard"/);
  assert.match(html, /class="mstrip"/);
  assert.match(html, /厦门三日游/);
});

test('顶栏:返回 + 分享 · 导出 · 更多(头像与画布控件都不进导航栏)', () => {
  const html = render();
  assert.match(html, /aria-label="返回"/);
  assert.match(html, /aria-label="分享"/);
  assert.match(html, /aria-label="导出"/);
  assert.match(html, /aria-label="更多"/);
});

test('按设计稿去掉位置条那一行(章节 chips + 页码)', () => {
  const html = render();
  assert.doesNotMatch(html, /1 \/ 8/, '页码行已删');
  assert.doesNotMatch(html, /class="mfolio"/, '位置条已删');
});

test('画布控件落在画板左下角:画板背景 + 一屏几页', () => {
  const html = render();
  assert.match(html, /aria-label="画板背景"/);
  assert.match(html, /aria-label="一屏几页"/);
  assert.match(html, /class="mfab-num">2</, '密度钮显示当前档位');
});

test('AI 气泡在画板右下角(两态同一位置)', () => {
  assert.match(render(), /class="mai"/);
});

test('i18n:英文 locale 下 chrome 不留中文(硬编码中文 = 英文用户看到中英混排)', () => {
  const html = render(BOOK, false);
  assert.match(html, /aria-label="Back"/);
  assert.match(html, /aria-label="Share"/);
  assert.match(html, /aria-label="Board background"/);
  assert.match(html, /aria-label="Pages per screen"/);
  assert.match(html, /aria-label="AI assistant"/);
  assert.match(html, /aria-label="Book preview"/);
  assert.match(html, /aria-label="Page 1"/, '预览栏每格的页码也要翻');
  // 只查界面文案:书名与页面内容都是数据(模板自带的示例文案里有中文),不参与 i18n。
  const labels = [...html.matchAll(/aria-label="([^"]*)"/g)].map((m) => m[1]!);
  const offenders = labels.filter((l) => /[一-龥]/.test(l));
  assert.deepEqual(offenders, [], `英文界面残留中文标签: ${offenders.join(', ')}`);
});

test('书册预览栏:整本书每页一格,当前页描框', () => {
  const html = render();
  const cells = html.match(/class="mstrip-cell"/g) ?? [];
  assert.equal(cells.length, BOOK.length, '每页一格');
  assert.match(html, /data-current="1"/, '当前页描框');
  assert.match(html, /data-slot="cover"/, '封面在条上可辨');
});

test('空书不炸:不渲染任何开页,预览栏为空', () => {
  const html = render([]);
  assert.doesNotMatch(html, /class="mspread"/);
  assert.doesNotMatch(html, /class="mstrip-cell"/);
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
  const src =
    source('MobileEditor.tsx') +
    source('MobileTopbar.tsx') +
    source('MobileStrip.tsx') +
    source('icons.tsx');
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
