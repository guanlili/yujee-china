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
import { PhotoPickerSheet } from './PhotoPickerSheet';
import { BoardBgSheet } from './BoardBgSheet';
import { ShareLinkModal } from './ShareLinkModal';
import {
  ExportMenuModal,
  CollageModal,
  ExportProgressModal,
  ExportFailModal,
} from './ExportModals';
import { MoreSheet, NoticeModal } from './MoreSheet';
import { AiChatSheet } from './AiChatSheet';
import { FilterSheet } from './FilterSheet';

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
    name: 'FilterSheet 照片风格',
    render: (open) =>
      renderToStaticMarkup(
        createElement(FilterSheet, {
          open,
          locale: 'zh',
          state: null,
          scope: 'book',
          photoId: 'photo-1',
          persistError: null,
          onChange: noop,
          onRetry: noop,
          onClose: noop,
        }),
      ),
    closeHint: /关闭风格面板/,
  },
  {
    name: 'PhotoPickerSheet 换图',
    render: (open) =>
      renderToStaticMarkup(
        createElement(PhotoPickerSheet, {
          open,
          zh: true,
          photoIds: ['photo-1', 'photo-2'],
          urls: { 'photo-1': 'blob:x' },
          currentPhotoId: 'photo-1',
          onPick: noop,
          onClose: noop,
        }),
      ),
    closeHint: /mes-cancel/,
  },
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
        createElement(ShareLinkModal, {
          open,
          zh: true,
          link: null,
          onConfirm: noop,
          onCopy: noop,
          onClose: noop,
        }),
      ),
    closeHint: /export-cancel/,
  },
  {
    name: 'ExportMenuModal 导出菜单',
    render: (open) =>
      renderToStaticMarkup(
        createElement(ExportMenuModal, {
          open, zh: true, onClose: noop,
          onCollage: noop, onLive: noop, onSinglePages: noop, onPdf: noop,
        }),
      ),
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
          onConfirm: noop,
          onClose: noop,
        }),
      ),
    closeHint: /collage-close/,
  },
  {
    name: 'ExportFailModal 导出失败',
    render: (open) =>
      renderToStaticMarkup(
        createElement(ExportFailModal, { open, zh: true, onClose: noop, onRetry: noop }),
      ),
    closeHint: /知道了/,
  },
  {
    name: 'MoreSheet 更多',
    render: (open) =>
      renderToStaticMarkup(
        createElement(MoreSheet, {
          open,
          zh: true,
          backupState: 'idle' as const,
          backupProgress: null,
          lutSupported: true,
          onClose: noop,
          onBackupPhotos: noop,
          onPhotoFilter: noop,
        }),
      ),
    closeHint: /export-cancel/,
  },
  {
    name: 'NoticeModal 告知',
    render: (open) =>
      renderToStaticMarkup(
        createElement(NoticeModal, {
          open,
          zh: true,
          title: '标题',
          message: '一句话',
          onClose: noop,
        }),
      ),
    closeHint: /知道了/,
  },
  {
    name: 'AiChatSheet AI对话',
    render: (open) =>
      renderToStaticMarkup(
        createElement(AiChatSheet, {
          open, zh: true, messages: [], status: { kind: 'idle' as const },
          onSend: noop, onClose: noop,
        }),
      ),
    closeHint: /mai-sheet-close/,
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

test('借用桌面样式的弹窗必须套 .editor-port 宿主(漏了样式一条都不命中)', () => {
  // 真机事故:PhotoPickerSheet 直接从 .mes-overlay 写起,漏了宿主那层。而 .mes-*/.modal-*
  // 借用的是桌面成品样式(定义在 editor-port.css,选择器带 .editor-port 祖先),于是遮罩、
  // 卡片底、定位全部失效 —— 照片网格裸奔铺满整屏盖住画布,标题被压成一个字。
  //
  // 判据按「用没用桌面那套类」来定,不是一刀切:AiChatSheet 走自有的 .mai-*
  // (就定义在 mobile-editor.css、无 .editor-port 前缀),它不需要这层宿主。
  for (const c of CASES) {
    const html = c.render(true);
    if (!/class="[^"]*\b(mes-|modal-)/.test(html)) continue; // 自有样式体系,豁免
    assert.match(
      html,
      /^<div class="editor-port mobile-modal-host"/,
      `${c.name} 用了 .mes-*/.modal-* 却没套宿主 —— 那套样式带 .editor-port 祖先,一条都不会命中`,
    );
  }
});


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
  // 只查宿主那一个规则块(到第一个 } 为止),别扫到无关的 .mtoast 等。
  const at = css.indexOf('.mobile-modal-host');
  const hostBlock = css.slice(at, css.indexOf('}', at) + 1);
  assert.doesNotMatch(
    hostBlock,
    /pointer-events\s*:\s*none/,
    '宿主一旦 pointer-events:none,就得逐个类名放行 —— 漏一个就是「弹窗关不掉」',
  );
});

test('AI 对话弹窗是可拖高度的:默认 75vh、下限 150px、上限 90vh', () => {
  const css = readFileSync(join(here, '..', 'mobile-editor.css'), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  );
  const at = css.indexOf('.mai-sheet {');
  assert.ok(at >= 0);
  const sheet = css.slice(at, css.indexOf('}', at));
  // height 必须写死一个 vh 值:靠内容撑高会让空对话只有一条气泡那么高,拖把手也没处拖。
  assert.match(sheet, /(?<!max-|min-)height:\s*75vh/, '默认高度 75vh —— 90vh 时选封面卡看不全');
  assert.match(sheet, /min-height:\s*150px/, '下限 150px(同桌面 .pane-chat-col)');
  assert.match(sheet, /max-height:\s*90vh/, '上限 90vh(同桌面)');
  assert.doesNotMatch(sheet, /max-height:\s*78vh/, '78vh 是改之前那个过高的值');
  // 把手要够大、且不能被浏览器当成页面滚动/下拉刷新
  const gAt = css.indexOf('.mai-sheet-grab {');
  const grab = css.slice(gAt, css.indexOf('}', gAt));
  assert.match(grab, /touch-action:\s*none/, '把手必须 touch-action:none,否则手机上拖不动');
  assert.match(grab, /cursor:\s*grab/);
  // 拖动中不许有过渡/动画插手,否则不跟手
  assert.match(css, /\.mai-sheet\[data-dragging='1'\]\s*\{[^}]*animation:\s*none/);
});

test('AI 对话把手真的接了拖拽(不是画个把手当装饰)', () => {
  const src = readFileSync(join(here, 'AiChatSheet.tsx'), 'utf8');
  assert.match(src, /onPointerDown=\{onGrabDown\}/);
  assert.match(src, /onPointerMove=\{onGrabMove\}/);
  assert.match(src, /onPointerUp=\{onGrabUp\}/);
  assert.match(src, /setPointerCapture/, '用指针捕获,手指滑出把手也不该断');
  // 底边钉死:高度 = 起始高度 - 位移
  assert.match(src, /d\.startH - d\.dy/, '底边钉死,下拉变矮');
  // 轻点把手 = 收起(与桌面同一语义)
  assert.match(src, /Math\.abs\(d\.dy\) <= TAP_SLOP[\s\S]{0,120}onClose\(\)/);
});

test('AI 是「浮标黑 / 弹窗浅」,别再搞反(曾做成白浮标 + 黑弹窗)', () => {
  // 既有设计(桌面 editor-port.css 的 .chat-fold-expand + ≤767 对话面板):
  // 收起时是一枚**黑色胶囊**浮标,展开的对话面板是**浅色**卡片 + 压暗遮罩。
  const css = readFileSync(join(here, '..', 'mobile-editor.css'), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  );
  const block = (sel: string) => {
    const at = css.indexOf(sel + ' {');
    assert.ok(at >= 0, `找不到 ${sel} 规则`);
    return css.slice(at, css.indexOf('}', at));
  };
  // 浮标:黑底白字
  const fab = block('.mobile-editor .mai');
  assert.match(fab, /background:\s*var\(--fg\)/, 'AI 浮标必须是黑色胶囊(var(--fg))');
  assert.match(fab, /color:\s*var\(--surface\)/, '黑胶囊上的字必须是浅色');
  // 弹窗:浅底深字
  const sheet = block('.mai-sheet');
  assert.match(sheet, /background:\s*var\(--surface\)/, '对话弹窗是浅色卡片,不是黑的');
  assert.match(sheet, /color:\s*var\(--fg\)/);
  // 水母是 multiply:压在黑底上会消失,所以必须探出胶囊(负偏移)且胶囊不许裁切
  const jelly = block('.mobile-editor .mai-jelly');
  assert.match(jelly, /mix-blend-mode:\s*multiply/);
  assert.match(jelly, /top:\s*-\d/, '水母必须探出胶囊上边(multiply 压黑底会消失)');
  assert.doesNotMatch(fab, /overflow:\s*hidden/, '浮标不许 overflow:hidden,会裁掉探出的水母');
});

test('「无背景」格必须有定位上下文,否则它的斜杠层会铺满整块面板挡住所有颜色', () => {
  // 真实 bug(真机自测抓到):桌面把斜杠 ::after(position:absolute;inset:0)挂在
  // .bbg-swatch 上,那个类自带 position:relative。页面底色面板复用的是 .mes-sw ——
  // 它没有定位上下文,于是斜杠逃到弹窗卡片上铺满整块,颜色格一个都点不动。
  const panel = readFileSync(join(here, 'PageBgPanel.tsx'), 'utf8');
  const usesMesSw = /className=\{`mes-sw bbg-none/.test(panel);
  if (!usesMesSw) return; // 换了别的类就不适用了
  const css = readFileSync(join(here, '..', 'mobile-editor.css'), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  );
  const at = css.indexOf('.mes-sw.bbg-none');
  assert.ok(at >= 0, '缺少给 .mes-sw.bbg-none 补定位上下文的规则 —— 底色面板会点不动');
  assert.match(
    css.slice(at, css.indexOf('}', at)),
    /position:\s*relative/,
    '.mes-sw.bbg-none 必须 position:relative,把斜杠层关在这一格里',
  );
});

/* 面板 ≠ 弹窗:面板是塞进 ElementSheet 里的**内容**(没有 open/关闭的概念,
   由外层 sheet 负责开关),因此不受「必须能关」的约束。豁免必须显式列在这里 ——
   新增文件要么补进 CASES(弹窗),要么进这张表(面板),不允许悄悄溜过。 */
const PANELS_NOT_MODALS = new Set(['TextPanel', 'PageBgPanel', 'ColorPicker']);

test('完整性:modals 目录下每个弹窗组件都进了本文件的用例表', () => {
  const files = readdirSync(here)
    .filter((f) => f.endsWith('.tsx') && f !== 'ModalHost.tsx')
    .map((f) => f.replace('.tsx', ''));
  // ExportModals 一个文件里含四个弹窗,单独记账
  const covered = new Set(
    CASES.map((c) => c.name.split(' ')[0]).concat(['ExportMenuModal', 'ExportProgressModal', 'MoreSheet']),
  );
  for (const f of files) {
    const ok =
      covered.has(f) ||
      PANELS_NOT_MODALS.has(f) ||
      (f === 'ExportModals' && covered.has('ExportMenuModal')) ||
      (f === 'MoreSheet' && covered.has('NoticeModal'));
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
