import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// 画板保真回归(2026-07-15):总览网格(#ovGrid)就是主画板 —— 无限画布,可缩放到
// 3x,所有编辑工具直接在上面用(EditorPort「画板 = 无限画布」注释)。它的渲染
// 必须和书籍视图完全一致:display 派生图 + fitTextBoxes + data-editable 标记。
// thumb 降级模式(240px 图、跳 fit-text、跳编辑标记)只允许用在底部 52px 缩略
// 图条上。此前把画板格误降级成 thumb → 画板和书籍预览内容不一致 + 编辑绑定丢失。

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, 'EditorPort.tsx'), 'utf8') + '\n\n' + readFileSync(join(here, 'EditorBook.tsx'), 'utf8');

function fnBody(name: string): string {
  const at = src.indexOf(`function ${name}(`);
  assert.ok(at > -1, `${name} must exist`);
  // 到下一个同缩进 function 声明为止,够覆盖函数体。
  const next = src.indexOf('\n    function ', at + 1);
  return src.slice(at, next === -1 ? at + 4000 : next);
}

test('画板(总览网格)按书籍视图同款全保真模式 paint,绝不 thumb 降级', () => {
  const overview = fnBody('renderOverview');
  assert.match(overview, /paintEl\(/, 'renderOverview paints via paintEl');
  assert.doesNotMatch(
    overview,
    /thumb:\s*true/,
    '画板格不得用 thumb 模式(240px 图/跳 fit-text/跳 data-editable 会让画板和书籍预览不一致)',
  );
});

test('repaintPages 的画板格更新同样全保真', () => {
  const repaint = fnBody('repaintPages');
  assert.doesNotMatch(repaint, /oface[\s\S]{0,200}thumb:\s*true/, '脏页重绘的画板格不得 thumb 降级');
});

test('迷你页面预览条已移除:不再有 thumb 降级表面(2026-07-15 拍板)', () => {
  // 底部栏只剩页面切换 ‹ n/N › + 缩放 + 视图切换;20+ 页时缩略图条是一排完整
  // 页面 DOM,纯性能负担。paintEl 全表面统一全保真。
  assert.doesNotMatch(src, /function buildThumbs|function paintThumbCell|thumbRow/, '缩略图机器必须整体移除');
  assert.doesNotMatch(src, /thumb:\s*true/, 'paintEl 不再有 thumb 降级模式');
});

test('底部栏最右是视图切换两档,悬停出气泡(预览模式/画布模式)', () => {
  assert.match(src, /id="viewBookBtn"[\s\S]{0,200}data-i18n-tip="previewMode"/);
  assert.match(src, /id="viewCanvasBtn"[\s\S]{0,200}data-i18n-tip="canvasMode"/);
  assert.match(src, /viewBook:.*exitOverview|viewBook:[\s\S]{0,120}exitOverview/, '预览模式按钮退出画布');
  assert.match(src, /viewCanvas:[\s\S]{0,120}enterOverview/, '画布模式按钮进入无限画布');
  // 排完版默认进画板:非收集态根元素首帧带 overview-on(用户拍板 2026-07-18)。
  assert.match(src, /startOnCanvas = !\(mode === 'authoring' && initialPages\.length === 0\)/, '非收集态默认落在画板视图');
  assert.match(src, /\$\{startOnCanvas \? ' overview-on' : ''\}/, '根元素按 startOnCanvas 条件带 overview-on,首帧即画板');
  // 画板(编辑)按钮排在画册按钮左边 —— 源码里 viewCanvasBtn 必须出现在 viewBookBtn 之前。
  assert.ok(src.indexOf('id="viewCanvasBtn"') < src.indexOf('id="viewBookBtn"'), '画板按钮在画册按钮左边(源码顺序在前)');
  const css = readFileSync(join(here, 'editor-port.css'), 'utf8');
  assert.match(css, /\[data-tip\]:hover::after/, '悬停气泡由 [data-tip] CSS 提供');
});

test('画板 will-change 只在手势窗口内挂,不得常驻(常驻 = 放大永远糊)', () => {
  // 常驻 will-change:transform 让合成器按 ~200px 布局尺寸缓存位图,放大 3x 是在
  // 放大低分辨率快照。必须手势中挂(.ov-gesturing)、停手后摘掉触发重新光栅化。
  const css = readFileSync(join(here, 'editor-port.css'), 'utf8');
  const ovGridBase = /\.ov-grid\{[^}]*\}/.exec(css)?.[0] ?? '';
  assert.ok(ovGridBase, '.ov-grid base rule must exist');
  assert.doesNotMatch(ovGridBase, /will-change/, '.ov-grid 基础规则不得常驻 will-change');
  assert.match(css, /\.ov-grid\.ov-gesturing\{[^}]*will-change:transform/, '手势态才挂 will-change');
  assert.match(src, /classList\.add\('ov-gesturing'\)/);
  assert.match(src, /classList\.remove\('ov-gesturing'\)/);
});
