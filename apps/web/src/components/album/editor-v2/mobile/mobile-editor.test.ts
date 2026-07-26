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
      imagePos: null,
      onImagePos: noop, onImagePosCommit: noop,
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
  assert.match(html, /aria-label="Expand chat"/);
  assert.match(html, /aria-label="Book preview"/);
  assert.match(html, /aria-label="Page 1"/, '预览栏每格的页码也要翻');
  // 只查界面文案:书名与页面内容都是数据(模板自带的示例文案里有中文),不参与 i18n。
  const labels = [...html.matchAll(/aria-label="([^"]*)"/g)].map((m) => m[1]!);
  const offenders = labels.filter((l) => /[一-龥]/.test(l));
  assert.deepEqual(offenders, [], `英文界面残留中文标签: ${offenders.join(', ')}`);
});

/* ── 书之所以像本书:书脊中缝 + 底部翻页条 + 书浮在画板上 ─────────────────────
   这三样是产品既有效果,不是可省的装饰(用户明确要求别动)。 */

test('双页开页有书脊中缝;单页(密度 1 / 独页 / 编辑态)没有', () => {
  const html = render(); // 默认密度 2,游标在封面(独页)
  assert.match(html, /data-halves="1"/, '封面独页只摆一页');
  assert.doesNotMatch(
    html,
    /data-solo="1"[^>]*data-halves="2"/,
    '独页不该摆两页',
  );
  // 中缝本身是 CSS ::before,按 data-halves="2" 命中 —— 守住那条规则还在
  const css = source('mobile-editor.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const at = css.indexOf(".mspread[data-halves='2']::before");
  assert.ok(at >= 0, '书脊中缝规则被删了 —— 两页之间那道竖向阴影是书的关键');
  const spine = css.slice(at, css.indexOf('}', at));
  assert.match(spine, /left:\s*50%/, '中缝要在正中');
  assert.match(spine, /rgba\(0,\s*0,\s*0,\s*0\.14\)/, '中心那道最深的阴影(取自 FlipBook)不许改淡');
  assert.match(spine, /pointer-events:\s*none/, '中缝不许拦点击(会挡住选中文字)');
});

test('书脊中缝的条件是「真摆了两张面」,不是「非独页」(密度 1 / 双宽页都会踩这个坑)', () => {
  const src = source('MobileEditor.tsx');
  assert.match(src, /data-halves=\{faces\.length\}/, '面数必须如实透出给 CSS');
  const css = source('mobile-editor.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(
    css,
    /\.mspread:not\(\[data-solo\]\)::before/,
    '按 solo 判会给密度 1 的单页、以及双宽跨页也画中缝 —— 必须按 data-halves',
  );
});

test('双宽跨页(#303):一张面 + 两页宽容器,不许缩成半宽、不许画中缝', () => {
  const src = source('MobileEditor.tsx');
  // 容器宽按 wide 算,不按面数算
  assert.match(src, /fitBox\(availW, rowH, spreadAspect\(resting\.wide\)\)/,
    '容器宽度必须按 wide 算 —— 按面数算会把双宽页压成半宽');
  assert.match(src, /sp\.kind === 'full'[\s\S]{0,80}wide: 2/, 'full 必须是「一张面 + 两页宽」');
  // 编辑态同样要按双宽摆
  const edit = source('EditView.tsx');
  assert.match(edit, /isSpreadTemplate\(page\.templateId\) \? 2 : 1/, '编辑态也要认双宽页');
});

/* ── 从编辑态返回:位置要保持、内容不许被清空 ─────────────────────────────────
   真实事故:返回浏览态后整本书渲染成空白,而且再也回不来。根因是量画板的
   ResizeObserver 生命周期 —— 进编辑态时浏览态的 .mboard 被卸载,RO 对脱离文档的节点
   上报 0×0,把 area 写成 0;返回时挂的是新节点,而 effect 依赖 [] 不重跑、RO 还盯着
   旧节点 → area 永远 0 → fitBox(0) → 整页渲染成空串。 */

test('量画板的 effect 必须跟着浏览/编辑态重挂(否则返回后量不到新节点)', () => {
  const src = source('MobileEditor.tsx');
  assert.match(src, /const browsing = editPage == null/, '要有 browsing 这个判据');
  assert.match(
    src,
    /new ResizeObserver\(measure\)[\s\S]{0,160}\}, \[browsing\]\)/,
    '测量 effect 的依赖必须带 browsing —— 依赖 [] 时返回浏览态永远量不到新的 .mboard',
  );
});

test('0×0 一律不收:节点卸载时 RO 会报 0,收了就把书渲染成空白', () => {
  for (const f of ['MobileEditor.tsx', 'EditView.tsx']) {
    const src = source(f);
    assert.match(
      src,
      /if \(r\.width < 1 \|\| r\.height < 1\) return;/,
      `${f} 必须丢弃 0×0 的测量结果(留住上一次的好尺寸,返回时首帧就正确)`,
    );
  }
});

test('返回浏览态要对齐到刚编辑那页所在的屏(不是跳回开头)', () => {
  const src = source('MobileEditor.tsx');
  assert.match(
    src,
    /setStartPage\(screenStartOfPage\(spreads, pages, editPage, density\)\)[\s\S]{0,80}onExitEdit/,
    '退出编辑前必须把浏览游标对齐到 editPage 所在的屏',
  );
});

test('翻纸:目标屏的面必须从目标屏自己取(拿当前屏的开页序号去查 = 正反面画同一屏)', () => {
  // 真实 bug(真机抓到、单测抓不到):layoutOf 读的是 spreads[si],把**当前屏**的 si
  // 传给目标屏,查回来还是当前那个开页 → 纸片正反面是同一屏,「翻了但没换页」。
  const src = source('MobileEditor.tsx');
  assert.doesNotMatch(
    src,
    /layoutOf\(\s*browseScreen\([^)]*\)\s*,\s*si\s*\)/,
    '不许拿当前屏的 si 去查目标屏 —— 走 soleLayout(它从屏自己的 spreadIndices 取)',
  );
  assert.match(src, /const soleLayout = useCallback/, 'soleLayout 是那个防呆口子,别删');
  assert.match(src, /soleLayout\(toScreen\)/, '目标屏的面必须经 soleLayout 取');
});

test('翻纸:时长/缓动/景深都取自 FlipBook,不自己定', () => {
  const src = source('MobileEditor.tsx');
  assert.match(src, /FLIP_MS/, '时长走 flip.ts 的常量(它对齐 FlipBook)');
  assert.match(src, /FLIP_EASE/);
  assert.doesNotMatch(src, /transition: `transform \d+ms/, '不许在组件里写死时长');
  const css = source('mobile-editor.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /perspective:\s*2400px/, '景深 2400px,同 FlipBook 的 stage');
  const at = css.indexOf('.mobile-editor .mleaf {');
  assert.ok(at >= 0, '翻动纸片的规则被删了');
  const leaf = css.slice(at, css.indexOf('}', at));
  assert.match(leaf, /transform-style:\s*preserve-3d/, '不 preserve-3d 纸片会被压平');
  assert.match(leaf, /pointer-events:\s*none/, '翻的过程中纸片不许吃掉点击');
});

test('翻纸中不接新翻页、不误触进编辑', () => {
  const src = source('MobileEditor.tsx');
  assert.match(src, /if \(anim\) return;[\s\S]{0,80}stepScreen/, '翻纸中再滑要被挡掉');
  assert.match(src, /if \(anim\) return;[\s\S]{0,120}data-page-index/, '翻纸中轻点不该进编辑态');
});

test('底部翻页条 + 书浮在画板上:两样都不许去掉', () => {
  const html = render();
  assert.match(html, /class="mstrip"/, '底部翻页条不许去掉');
  assert.match(html, /class="mstrip-track"/);
  assert.match(html, /class="mboard"/, '画板不许去掉');
  assert.match(html, /class="mspread"/, '书要浮在画板上');
  const css = source('mobile-editor.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const at = css.indexOf('.mobile-editor .mspread {');
  assert.match(
    css.slice(at, css.indexOf('}', at)),
    /box-shadow/,
    '书要有投影才像浮在画板上',
  );
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
