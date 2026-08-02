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
   风格(滤镜)面板的收敛守卫。

   改之前面板把每件事都摊在台面上:标题右边一个 scope 标签、下面一个 scope 二选一、
   再下面还有一条「跟随全书风格」下划线链接 —— 三个控件在回答同一个问题。强度滑块常驻
   且用 disabled 灰着占位。27 张卡 4 列平铺,面板高度吃满 calc(100vh - 86px)。

   最要命的是语义:photo scope 下 apply(null) 写的是 overrides[id] = null(这张**明确
   不要滤镜**),而「跟随全书风格」调 clearPhotoOverride(**删掉 override**)。两个不同的
   状态,一个做成卡片、一个做成下划线链接,用户看不出它们是同一维度的选择。

   收敛后:「跟随全书」是网格里的第一张卡,与「原片」并列。scope 只剩一个控件。
   强度按需挂载(不是 disabled)。预览固定 100% 生成,拖滑块不再重跑 27 个 LUT。
   ════════════════════════════════════════════════════════════════════════════ */

const here = dirname(fileURLToPath(import.meta.url));
const read = (...p: string[]) => readFileSync(join(here, ...p), 'utf8');

const PHOTO = 'selected';
const base = {
  locale: 'en',
  photoId: PHOTO,
  persistError: null,
  onChange: () => undefined,
  onScopeChange: () => undefined,
  onRetry: () => undefined,
  onClose: () => undefined,
} as const;

async function renderBar(overrides: Record<string, unknown>) {
  const { FilterBar } = await import('./FilterBar');
  return renderToStaticMarkup(createElement(FilterBar, { ...base, ...overrides } as never));
}

test('photo scope:第一张卡是「跟随全书」,与「原片」并列(不再是下划线链接)', async () => {
  const html = await renderBar({ state: { default: null }, scope: 'photo' });
  const cards = html.match(/<button[^>]*class="filter-card[^"]*"[^>]*>/g) ?? [];
  assert.ok(cards.length > 0, '应该渲染出卡片');
  assert.match(
    html,
    /class="filter-card filter-card-follow"/,
    '「跟随全书」必须是网格里的一张卡,承载 clearPhotoOverride 那个语义',
  );
  const followAt = html.indexOf('filter-card-follow');
  const originalAt = html.indexOf('Original');
  assert.ok(followAt >= 0 && followAt < originalAt, '「跟随全书」排在「原片」之前');
});

test('book scope:没有「跟随全书」这张卡(全书本身就是被跟随的那个)', async () => {
  const html = await renderBar({ state: { default: null }, scope: 'book' });
  assert.doesNotMatch(html, /filter-card-follow/, 'book scope 下「跟随全书」无意义');
});

test('「跟随全书」下划线链接彻底消失(回归守卫)', async () => {
  const html = await renderBar({ state: { default: null }, scope: 'photo' });
  assert.doesNotMatch(html, /filter-follow-book/, '那条链接是三控件重叠的根源,不许回来');
  assert.doesNotMatch(read('FilterBar.tsx'), /filter-follow-book/);
});

test('scope 只由一个控件表达 —— 标题旁那份重复标签没了', async () => {
  const html = await renderBar({ state: { default: null }, scope: 'photo' });
  // 改之前:标题右边一个 <span>当前照片</span>,下面又一个二选一胶囊 —— 同一件事说两遍。
  assert.equal(
    (html.match(/This photo/g) ?? []).length,
    1,
    'scope 文案只该出现在二选一胶囊里,标题旁不再挂一份',
  );
  assert.equal((html.match(/Whole book/g) ?? []).length, 1);
});

test('没有生效滤镜时,强度滑块不挂载 —— 不是 disabled 灰着占位', async () => {
  // overrides[PHOTO] = null 意思是「这张明确不要滤镜」,没有强度可言。
  const html = await renderBar({
    state: { default: { lutId: 'cloudy-cool', strength: 80 }, overrides: { [PHOTO]: null } },
    scope: 'photo',
  });
  assert.doesNotMatch(html, /type="range"/, '无滤镜时整个强度行都不该存在');
});

test('有生效滤镜时才出现强度滑块', async () => {
  const html = await renderBar({
    state: { default: null, overrides: { [PHOTO]: { lutId: 'cloudy-cool', strength: 60 } } },
    scope: 'photo',
  });
  assert.match(html, /type="range"/);
  assert.match(html, /aria-label="Filter strength"/);
});

test('预览生成不依赖 strength —— 拖滑块不能重跑 27 个 LUT(性能回归守卫)', () => {
  const src = read('FilterBar.tsx');
  const deps = /\}, \[photoId[^\]]*\]\);/.exec(src)?.[0] ?? '';
  assert.ok(deps.length > 0, '应该找得到预览 effect 的依赖数组');
  assert.doesNotMatch(
    deps,
    /strength/,
    'strength 进依赖 = 每动一格销毁 28 个 objectURL 并重跑 27 次 WebGL',
  );
  assert.match(
    src,
    /PREVIEW_STRENGTH/,
    '预览要用固定强度常量生成,不读当前 strength',
  );
});

test('卡片是三排横滑(2026-08-02),不是吃满屏的多行平铺', () => {
  const css = read('editor-port.css');
  const strip = /\.editor-port \.filter-grid\{[^}]*\}/.exec(css)?.[0] ?? '';
  assert.ok(strip.length > 0, '应该有 .filter-grid 规则');
  assert.match(strip, /overflow-x:\s*auto/, '横向滚动是这次收敛的核心');
  assert.match(strip, /grid-template-rows:repeat\(3, auto\)/, '一个版面三行(用户拍板)');
  assert.match(strip, /grid-auto-flow:column/, '按列填,横滑 = 下一批滤镜');
  assert.doesNotMatch(strip, /grid-template-columns:repeat\(4/, '4 列平铺是旧形态');
});

test('桌面面板钉在底部,且不铺满宽度(否则盖住左侧对话面板)', () => {
  const css = read('editor-port.css');
  const panel = /\.editor-port \.filter-bar\{[^}]*\}/.exec(css)?.[0] ?? '';
  assert.ok(panel.length > 0);
  assert.match(panel, /bottom:/, '从右上角浮层改成底部');
  assert.doesNotMatch(panel, /top:68px/, 'top:68px 是旧的右上角定位');
  assert.match(panel, /border-radius:\s*var\(--radius-lg\)/, '沿用共享圆角 token');
  // 左边界必须让开那条 360px 的对话栏,否则「不铺满」也还是会压到它。
  assert.match(panel, /left:\s*378px/, '360px 对话栏 + 18px 间距');
  assert.match(panel, /margin-inline:\s*auto/, '在画布区域内居中,不是视口居中');
  assert.match(
    css,
    /\.editor-port\.chat-collapsed \.filter-bar\{[^}]*left:\s*18px/,
    '对话收起后画布铺满,左边界要跟着回去',
  );
});

test('移动端风格抽屉跟内容走,不再固定占 2/3 屏(垫底背景抽屉仍是 66vh)', () => {
  const css = read('mobile', 'mobile-editor.css');
  const rule = /\.mobile-bottom-sheet\.mobile-filter-sheet \{[^}]*\}/.exec(css)?.[0] ?? '';
  assert.ok(rule.length > 0, '应该有风格抽屉的高度覆盖');
  assert.match(rule, /height:\s*auto/, '横滑一排之后不需要 66vh');
  // 共享的 66vh 规则必须还在 —— BoardBgSheet 靠它。
  assert.match(css, /\.modal-card\.mobile-bottom-sheet \{[^}]*height:\s*66vh/);
});

test('没有 scope 切换器时(移动端),标题退回静态 scope 标签 —— 不能让用户不知道在改谁', async () => {
  // FilterSheet 不传 onScopeChange:移动端的 scope 由入口决定(选中照片 / 更多→全书风格)。
  // 收敛掉标题旁那份「重复」标签时差点把移动端唯一的 scope 提示一起删掉。
  const { FilterBar } = await import('./FilterBar');
  const html = renderToStaticMarkup(createElement(FilterBar, {
    ...base,
    state: { default: null },
    scope: 'photo',
    onScopeChange: undefined,
    embedded: true,
  } as never));
  assert.doesNotMatch(html, /filter-scope-switch/, '没给回调就不该渲染切换器');
  assert.match(html, /filter-scope-label/, '得有个静态标签兜底');
  assert.equal((html.match(/This photo/g) ?? []).length, 1, '仍然只有一处表达 scope');
});
