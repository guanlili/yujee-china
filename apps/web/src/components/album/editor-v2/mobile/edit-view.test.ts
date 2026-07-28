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

import * as EditViewModule from './EditView';
import type { EditorPage } from '../../types';

const { EditView } = EditViewModule;
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

type Sel = { slotId: string; rect: { left: number; top: number; width: number; height: number } };

function render(
  editPage: number,
  opts: { zh?: boolean; selection?: Sel | null; sheetOpen?: boolean } = {},
) {
  return renderToStaticMarkup(
    createElement(EditView, {
      pages: BOOK,
      resolve: () => undefined,
      zh: opts.zh ?? true,
      editPage,
      selection: opts.selection ?? null,
      photoFilter: null, selectedPhotoId: null, lutSupported: false,
      sheetOpen: opts.sheetOpen ?? false,
      onExit: noop,
      onStep: noop,
      onSelectText: noop, onSelectImage: noop, onClearSelection: noop,
      imagePos: null,
      onImagePos: noop, onImagePosCommit: noop,
      onSave: noop, backupState: 'idle' as const, backupProgress: null,
      onReplaceImage: noop, onClearImage: noop, onResetImagePos: noop,
      onPhotoFilter: noop,
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

/* ── 选中链路 ─────────────────────────────────────────────────────────────── */

test('没选中时不画高亮框', () => {
  assert.doesNotMatch(render(2), /class="msel"/);
});

test('选中时画一个 React 拥有的高亮框(不往页面 innerHTML 里塞节点)', () => {
  const html = render(2, {
    selection: { slotId: 'title', rect: { left: 12, top: 34, width: 200, height: 56 } },
  });
  assert.match(html, /class="msel"/);
  // 位置来自点击那一刻的 rect;框是 .mspread 的兄弟节点,不是页面内容的一部分
  assert.match(html, /left:12px/);
  assert.match(html, /top:34px/);
  assert.match(html, /width:200px/);
  assert.match(html, /height:56px/);
  assert.match(html, /aria-hidden="true"/);
});

test('图片工具栏内的嵌套目标不启动画板手势,普通图片目标仍启动', () => {
  type FakeElement = {
    className: string;
    parentElement: FakeElement | null;
    closest: (selector: string) => FakeElement | null;
  };
  const element = (className: string, parentElement: FakeElement | null = null): FakeElement => {
    const node: FakeElement = {
      className,
      parentElement,
      closest(selector) {
        if (selector !== '.mimg-bar') return null;
        for (let current: FakeElement | null = node; current; current = current.parentElement) {
          if (current.className.split(/\s+/).includes('mimg-bar')) return current;
        }
        return null;
      },
    };
    return node;
  };
  const toolbar = element('mimg-bar');
  const button = element('mimg-btn', toolbar);
  const icon = element('mimg-ic', button);
  const selectedImage = element('selected-image');
  const shouldStart = (
    EditViewModule as typeof EditViewModule & {
      shouldStartBoardGesture?: (target: EventTarget | null) => boolean;
    }
  ).shouldStartBoardGesture;

  assert.equal(typeof shouldStart, 'function', 'EditView must expose the production gesture guard');
  assert.equal(shouldStart!(icon as unknown as EventTarget), false);
  assert.equal(shouldStart!(selectedImage as unknown as EventTarget), true);
  assert.equal(shouldStart!({} as EventTarget), true, 'non-Element targets must be safe');
  assert.equal(shouldStart!(null), true);
  assert.match(
    source('EditView.tsx'),
    /onPointerDown[\s\S]*shouldStartBoardGesture\(e\.target\)/,
    'the board pointerdown handler must use the tested guard',
  );
});

test('面板升起且选中的元素靠下时,书整体上移让出位置(只有位移,没有缩放)', () => {
  // renderToStaticMarkup 里量不到尺寸(area 全 0)→ lift 必为 0,这里守住「没量到就不乱移」。
  const html = render(2, {
    selection: { slotId: 'title', rect: { left: 0, top: 900, width: 100, height: 40 } },
    sheetOpen: true,
  });
  assert.doesNotMatch(html, /scale\(/, '书不做自由缩放 —— 让位只能靠 translateY');
});

test('i18n:英文 locale 下编辑态不留中文', () => {
  const html = render(3, { zh: false });
  assert.match(html, /Page 4/);
  assert.match(html, /aria-label="Back to browsing"/);
  assert.match(html, /aria-label="Expand chat"/);
  assert.match(html, /aria-label="Editing tools"/);
  for (const label of ['Background', 'Photo', 'Text', 'Delete']) {
    assert.ok(html.includes(`>${label}</span>`), `一级栏缺英文「${label}」`);
  }
  // 只查界面文案:页面内容是数据(模板自带示例文案含中文),不参与 i18n。
  const labels = [...html.matchAll(/aria-label="([^"]*)"/g)].map((m) => m[1]!);
  const offenders = labels.filter((l) => /[一-龥]/.test(l));
  assert.deepEqual(offenders, [], `英文界面残留中文标签: ${offenders.join(', ')}`);
  const cells = [...html.matchAll(/<span>([^<]*)<\/span>/g)].map((m) => m[1]!);
  assert.deepEqual(
    cells.filter((c) => /[一-龥]/.test(c)),
    [],
    '一级栏还有中文格',
  );
});

/* ── 架构守卫:编辑态这棵子树同样不许碰桌面 DOM ─────────────────────────────── */
test('架构守卫:EditView 不碰任何桌面 DOM', () => {
  // 先剥注释:抬头说明里就写着「不许碰 document/querySelector」,那是文字不是代码。
  const src = source('EditView.tsx')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(src, /\bdocument\./);
  assert.doesNotMatch(src, /querySelector/);
  assert.doesNotMatch(src, /createElement\(['"]/);
  assert.doesNotMatch(src, /#ovGrid|ov-page|ov-spread/);
});

test('架构守卫:选中只做命中判定,不去改别人的节点', () => {
  const src = source('EditView.tsx');
  // 命中按「这一点上的 z 序」判定 —— 只看 e.target 会让叠压页面的文字全都选不中
  // (真机抓到:click 的 target 是底下的 <img>,而同坐标最上层其实是文字)。
  assert.match(src, /elementsFromPoint\(/, '命中走 elementsFromPoint(按 z 序)');
  assert.match(src, /closest/, '再用 closest 归到具体槽');
  // 高亮是自己渲染的兄弟节点,不是给页面节点加类/改 style
  assert.doesNotMatch(src, /\.classList\.(add|remove|toggle)/, '不许给页面里的节点加类');
  assert.doesNotMatch(src, /\.style\.[a-z]/i, '不许直接改页面里节点的 style');
  assert.doesNotMatch(src, /setAttribute/, '不许往页面节点上写属性');
  // 只允许「读这一点上有谁」这一处;不许拿 document 去别处捞节点
  assert.doesNotMatch(src, /document\.querySelector/, '不许用 querySelector 到处找节点');
  assert.doesNotMatch(src, /#ovGrid|ov-page|ov-spread/, '不许依赖桌面画布的 DOM 契约');
});
