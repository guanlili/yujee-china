import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import * as React from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// tsx 在本仓按 classic runtime 编译 JSX,SSR 渲染测试要显式挂全局 React(同 mobile-filter.test.ts)。
(globalThis as { React?: typeof React }).React = React;

/* ════════════════════════════════════════════════════════════════════════════
   风格面板这一轮的三件事:
     1. 移动端也能改「整本书」—— 弹窗里给 scope 切换器,不再只能从「更多」进全书档
     2. 卡片列表两端加翻页箭头(鼠标不好横滑,而且横滑条不会说「右边还有」)
     3. 移动端卡片排三排横滑(一排在手机上只露三四张,要滑七八次才扫得完 27 个)
   ════════════════════════════════════════════════════════════════════════════ */

const here = dirname(fileURLToPath(import.meta.url));
const read = (...p: string[]) => readFileSync(join(here, ...p), 'utf8');

const base = {
  locale: 'en',
  photoId: 'selected',
  persistError: null,
  onChange: () => undefined,
  onRetry: () => undefined,
  onClose: () => undefined,
} as const;

async function renderBar(overrides: Record<string, unknown>) {
  const { FilterBar } = await import('./FilterBar');
  return renderToStaticMarkup(createElement(FilterBar, { ...base, ...overrides } as never));
}

/* ── 1. 移动端的全书档 ─────────────────────────────────────────────────────── */

test('移动端风格抽屉透传 onScopeChange —— 选中一张图后也能改成整本书', async () => {
  const { FilterSheet } = await import('./mobile/modals/FilterSheet');
  const html = renderToStaticMarkup(
    createElement(FilterSheet, {
      open: true,
      locale: 'en',
      state: { default: null },
      scope: 'photo',
      photoId: 'selected',
      persistError: null,
      onChange: () => undefined,
      onScopeChange: () => undefined,
      onRetry: () => undefined,
      onClose: () => undefined,
    } as never),
  );
  assert.match(html, /filter-scope-switch/, '给了回调就该出切换器');
  assert.match(html, /Whole book/, '全书档必须在弹窗里够得着');
  assert.doesNotMatch(html, /filter-scope-label/, '有切换器就不该再挂一份静态标签');
});

test('从「更多 → 全书风格」进来时不给切换器 —— 那时的 photoId 只是缩略图用的第一张', () => {
  const root = read('mobile', 'MobileEditorRoot.tsx');
  assert.match(root, /onScopeChange=\{filterPhotoScoped \? setFilterScope : undefined\}/);
  // 从选中的照片进来 → 可切;从「更多」进来 → 不可切。
  const selected = root.indexOf('const openSelectedPhotoFilter');
  const book = root.indexOf('const openBookFilter');
  assert.ok(selected > 0 && book > 0);
  assert.match(root.slice(selected, selected + 400), /setFilterPhotoScoped\(true\)/);
  assert.match(root.slice(book, book + 400), /setFilterPhotoScoped\(false\)/);
});

/* ── 2. 左右翻页 ───────────────────────────────────────────────────────────── */

test('27 张卡在任何视口都滚得动 → 首帧就有右翻页箭头', async () => {
  const html = await renderBar({ state: { default: null }, scope: 'photo' });
  assert.match(html, /class="filter-page filter-page-next"/);
  assert.match(html, /aria-label="Next styles"/);
  // 还没滚过 → 左箭头不该出现(不是灰着占位,是根本不挂)
  assert.doesNotMatch(html, /filter-page-prev/, '滚到头的方向不给按钮,不给死按钮');
});

test('翻页箭头按能不能滚那个方向出现,由真实测量驱动', () => {
  const src = read('FilterBar.tsx');
  assert.match(src, /scrollWidth - el\.clientWidth/, '能不能滚要量,不能猜');
  assert.match(src, /\{pager\.left && \(/);
  assert.match(src, /\{pager\.right && \(/);
  assert.match(src, /onScroll=\{syncPager\}/, '滚动中要跟着更新');
  assert.match(src, /new ResizeObserver\(syncPager\)/, '面板宽度变了也要重量');
  assert.match(src, /behavior: 'smooth'/);
  assert.doesNotMatch(src, /className="filter-page[^"]*"[^>]*disabled/, '不给灰着的死箭头');
});

test('箭头绝对定位,出现/消失不推动卡片', () => {
  const css = read('editor-port.css');
  const strip = /\.editor-port \.filter-strip\{([\s\S]*?)\}/.exec(css)?.[1] ?? '';
  const page = /\.editor-port \.filter-page\{([\s\S]*?)\}/.exec(css)?.[1] ?? '';
  assert.match(strip, /position:\s*relative/);
  assert.match(page, /position:\s*absolute/, 'flex 里的按钮一消失整排卡会横跳');
  assert.match(css, /\.editor-port \.filter-page-prev\{[^}]*left:/);
  assert.match(css, /\.editor-port \.filter-page-next\{[^}]*right:/);
});

/* ── 3. 移动端三排 ─────────────────────────────────────────────────────────── */

test('移动端卡片排三排、横向滚动(桌面仍是一排)', () => {
  const mobile = read('mobile', 'mobile-editor.css');
  const rule =
    /\.editor-port \.mobile-filter-sheet \.filter-grid \{([\s\S]*?)\}/.exec(mobile)?.[1] ?? '';
  assert.ok(rule.length > 0, '应该有移动端的三排覆盖');
  assert.match(rule, /grid-template-rows:\s*repeat\(3,/);
  assert.match(
    rule,
    /grid-auto-flow:\s*column/,
    '按列填才能让「横滑 = 下一批滤镜」;按行填会变成上下找,横滑就没意义了',
  );
  // 横向滚动来自共享的 .filter-grid,移动端只改排布不重复声明。
  const desktop = read('editor-port.css');
  const shared = /\.editor-port \.filter-grid\{([\s\S]*?)\}/.exec(desktop)?.[1] ?? '';
  assert.match(shared, /overflow-x:\s*auto/);
});

test('三排之后抽屉高度跟着放开,不至于逼出纵向滚动', () => {
  const mobile = read('mobile', 'mobile-editor.css');
  const rule =
    /\.mobile-bottom-sheet\.mobile-filter-sheet \{([\s\S]*?)\}/.exec(mobile)?.[1] ?? '';
  assert.match(rule, /height:\s*auto/, '仍然跟内容走,不是固定 66vh');
  const cap = /max-height:\s*min\((\d+)vh,\s*(\d+)px\)/.exec(rule);
  assert.ok(cap, '应该有 max-height 上限');
  assert.ok(Number(cap[2]) >= 460, `三排卡放不下 ${cap[2]}px`);
});
