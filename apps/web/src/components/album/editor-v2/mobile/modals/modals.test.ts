import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import * as React from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// tsx classic JSX transform → 组件产物引用全局 React(同 mag-02-toc-render.test.ts)。
(globalThis as { React?: typeof React }).React = React;

import { ModalHost } from './ModalHost';
import { ElementSheet } from './ElementSheet';
import { BoardBgSheet } from './BoardBgSheet';
import { ShareLinkModal } from './ShareLinkModal';
import { PhotoPickerModal } from './PhotoPickerModal';
import {
  ExportMenuModal,
  CollageModal,
  ExportProgressModal,
  ExportFailModal,
} from './ExportModals';

/* ════════════════════════════════════════════════════════════════════════════
   移动端弹窗的完整性守卫。

   起因是一个真实事故:宿主层曾设 pointer-events:none 再按类名逐个放行,名单漏掉
   .mes-overlay → 文字弹窗展开后连「取消/完成」都点不动,开了就关不掉。
   这类洞靠人工逐个点是兜不住的,必须由测试盯着:
     · 关着时不渲染任何东西(宿主一存在就接管事件,不能空占)
     · 开着时必须有关闭入口
     · 宿主样式里不许再出现 pointer-events:none 那套放行名单
   ════════════════════════════════════════════════════════════════════════════ */

const here = dirname(fileURLToPath(import.meta.url));
const noop = () => {};

/** 每个弹窗:给一份关着的 props 和一份开着的 props。 */
const CASES: { name: string; render: (open: boolean) => string; closeHint: RegExp }[] = [
  {
    name: 'BoardBgSheet 画板背景',
    render: (open) =>
      renderToStaticMarkup(
        createElement(BoardBgSheet, {
          open,
          zh: true,
          current: null,
          onClose: noop,
          onPick: noop,
          onUpload: noop,
        }),
      ),
    closeHint: /board-bg-close/,
  },
  {
    name: 'ShareLinkModal 分享链接',
    render: (open) =>
      renderToStaticMarkup(
        createElement(ShareLinkModal, { open, zh: true, link: null, onClose: noop }),
      ),
    closeHint: /export-cancel/,
  },
  {
    name: 'ExportMenuModal 导出菜单',
    render: (open) =>
      renderToStaticMarkup(createElement(ExportMenuModal, { open, zh: true, onClose: noop })),
    closeHint: /export-cancel/,
  },
  {
    name: 'CollageModal 拼图密度',
    render: (open) =>
      renderToStaticMarkup(
        createElement(CollageModal, {
          open,
          zh: true,
          spreadCount: 4,
          density: null,
          onPickDensity: noop,
          onClose: noop,
        }),
      ),
    closeHint: /collage-close/,
  },
  {
    name: 'ExportFailModal 导出失败',
    render: (open) =>
      renderToStaticMarkup(createElement(ExportFailModal, { open, zh: true, onClose: noop })),
    closeHint: /知道了/,
  },
  {
    name: 'PhotoPickerModal 换照片',
    render: (open) =>
      renderToStaticMarkup(
        createElement(PhotoPickerModal, {
          open,
          zh: true,
          photos: [],
          onSelect: noop,
          onClose: noop,
        }),
      ),
    closeHint: /取消/,
  },
  {
    name: 'ElementSheet 元素编辑',
    render: (open) =>
      renderToStaticMarkup(
        createElement(ElementSheet, {
          open,
          zh: true,
          title: '文字',
          onCancel: noop,
          onDone: noop,
          children: '内容',
        }),
      ),
    closeHint: /mes-cancel/,
  },
];

for (const c of CASES) {
  test(`${c.name}:关着时什么都不渲染(宿主不空占,否则会挡住底下)`, () => {
    assert.equal(c.render(false), '', `${c.name} 关闭时仍渲染了内容`);
  });

  test(`${c.name}:开着时必须有关闭入口(开了必须关得掉)`, () => {
    const html = c.render(true);
    assert.notEqual(html, '', `${c.name} 开启时没渲染`);
    assert.match(html, c.closeHint, `${c.name} 找不到关闭入口`);
  });
}

test('导出进度弹窗:渲染中不可关是有意为之,但必须显示进度', () => {
  const html = renderToStaticMarkup(
    createElement(ExportProgressModal, { open: true, zh: true, label: '3 / 8', percent: 40 }),
  );
  assert.match(html, /exp-bar-fill/);
  assert.match(html, /40%/, '进度条要反映百分比');
  assert.match(html, /3 \/ 8/);
});

test('架构守卫:宿主样式不许再用 pointer-events 放行名单(曾漏掉 .mes-overlay)', () => {
  const css = readFileSync(join(here, '..', 'mobile-editor.css'), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  );
  const hostBlock = css.slice(css.indexOf('.mobile-modal-host'));
  assert.doesNotMatch(
    hostBlock,
    /pointer-events\s*:\s*none/,
    '宿主一旦 pointer-events:none,就得逐个类名放行 —— 漏一个就是「弹窗关不掉」',
  );
});

/* 面板 ≠ 弹窗:面板是塞进 ElementSheet 里的**内容**(没有 open/关闭的概念,
   由外层 sheet 负责开关),因此不受「必须能关」的约束。豁免必须显式列在这里 ——
   新增文件要么补进 CASES(弹窗),要么进这张表(面板),不允许悄悄溜过。 */
const PANELS_NOT_MODALS = new Set(['TextPanel', 'PageBgPanel']);

test('完整性:modals 目录下每个弹窗组件都进了本文件的用例表', () => {
  const files = readdirSync(here)
    .filter((f) => f.endsWith('.tsx') && f !== 'ModalHost.tsx')
    .map((f) => f.replace('.tsx', ''));
  // ExportModals 一个文件里含四个弹窗,单独记账
  const covered = new Set(
    CASES.map((c) => c.name.split(' ')[0]).concat(['ExportMenuModal', 'ExportProgressModal']),
  );
  for (const f of files) {
    const ok =
      covered.has(f) ||
      PANELS_NOT_MODALS.has(f) ||
      (f === 'ExportModals' && covered.has('ExportMenuModal'));
    assert.ok(
      ok,
      `${f}.tsx 未归类 —— 弹窗要补进 CASES(必须能关),面板要进 PANELS_NOT_MODALS`,
    );
  }
});

test('面板是内容不是弹窗:自己不许渲染宿主/遮罩(开关归外层 sheet 管)', () => {
  for (const f of PANELS_NOT_MODALS) {
    const src = readFileSync(join(here, `${f}.tsx`), 'utf8');
    assert.doesNotMatch(src, /mobile-modal-host|modal-overlay|mes-overlay/, `${f} 不该自建宿主`);
  }
});

test('ModalHost:关着时返回 null,开着时带 open 类(过渡动画照旧)', () => {
  const closed = renderToStaticMarkup(
    createElement(ModalHost, { open: false, onClose: noop, children: 'x' }),
  );
  assert.equal(closed, '');
  const opened = renderToStaticMarkup(
    createElement(ModalHost, { open: true, onClose: noop, children: 'x' }),
  );
  assert.match(opened, /modal-overlay open/);
  assert.match(opened, /editor-port mobile-modal-host/, '宿主要带 editor-port 类才能命中桌面弹窗样式');
});
