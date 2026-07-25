import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import * as React from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// tsx classic JSX transform → 组件产物引用全局 React(同 mag-02-toc-render.test.ts)。
(globalThis as { React?: typeof React }).React = React;

import { EditView } from './EditView';
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

function render(editPage: number) {
  return renderToStaticMarkup(
    createElement(EditView, {
      pages: BOOK,
      resolve: () => undefined,
      editPage,
      onExit: noop,
      onStep: noop,
      onShare: noop, onExport: noop, onMore: noop, onOpenChat: noop,
      onPageBg: noop, onPickImage: noop, onPickText: noop, onDeletePage: noop,
    }),
  );
}

test('编辑态骨架:标记 data-mode=edit,只渲染一页(满屏单页,无对开半边)', () => {
  const html = render(3);
  assert.match(html, /class="mobile-editor" data-mode="edit"/);
  const pages = html.match(/class="mpage"/g) ?? [];
  assert.equal(pages.length, 1, '编辑态永远只显示当前一页');
});

test('编辑态顶栏标题是「第 N 页」(按设计稿,不再有被划掉的位置条那一行)', () => {
  assert.match(render(3), /第 4 页/); // editPage=3 → 第 4 页
  assert.match(render(0), /第 1 页/);
  assert.doesNotMatch(render(3), /4 \/ 8/, '页码条已按设计稿去掉');
});

test('编辑态顶栏:返回 + 分享 · 导出 · 更多', () => {
  const html = render(2);
  assert.match(html, /aria-label="返回浏览"/);
  assert.match(html, /aria-label="分享"/);
  assert.match(html, /aria-label="导出"/);
  assert.match(html, /aria-label="更多"/);
});

test('编辑态一级栏四格:背景 · 图片 · 文字 · 删除(删除走 danger 态)', () => {
  const html = render(2);
  const cells = html.match(/class="ml1-cell"|class="ml1-cell" data-danger="1"/g) ?? [];
  assert.equal(cells.length, 4, '一级栏必须是四格');
  for (const label of ['背景', '图片', '文字', '删除']) {
    assert.ok(html.includes(`>${label}</span>`), `缺少「${label}」格`);
  }
  assert.match(html, /data-danger="1"/, '删除格标记为危险动作');
});

test('编辑态有 AI 气泡(两态同一位置,右下角)', () => {
  assert.match(render(2), /class="mai"/);
});

/* ── 架构守卫:编辑态这棵子树同样不许碰桌面 DOM ─────────────────────────────── */
test('架构守卫:EditView 不碰任何桌面 DOM', () => {
  const src = source('EditView.tsx');
  assert.doesNotMatch(src, /\bdocument\./);
  assert.doesNotMatch(src, /querySelector/);
  assert.doesNotMatch(src, /createElement\(['"]/);
  assert.doesNotMatch(src, /#ovGrid|ov-page|ov-spread/);
});
