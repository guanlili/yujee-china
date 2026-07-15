import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// 响应式整体缩放(2026-07-15):.book 的尺寸是纯 CSS(min(94%, 80vh*1.414, 1010px)
// + aspect-ratio),随视口/容器缩放;但页面内容是 paintEl/faceHTML 在 paint 那一刻
// 按 el.clientWidth/Height 算死 scale 写进 innerHTML 的,不重绘就不跟随容器缩小
// (手机/平板整体缩放时内容溢出/不缩)。视口 resize + book-stage 容器尺寸变(聊天面板
// resize/折叠改 --canvas-inset → book 缩)都必须 debounced 重绘当前 spread/总览。

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, 'EditorPort.tsx'), 'utf8');

function block(anchor: string): string {
  const at = src.indexOf(anchor);
  assert.ok(at > -1, `${anchor} must exist`);
  return src.slice(at, at + 500);
}

test('存在 debounced 重绘,按视口/容器新尺寸重算页面 scale', () => {
  const b = block('const debouncedRepaint');
  assert.match(b, /clearTimeout|cancel/, 'debounced(连发只跑最后一次)');
  assert.match(b, /paintSpread\(currentCh\)/, '重绘当前 spread(按新 clientWidth 重算 scale)');
  assert.match(b, /renderOverview\(\)/, '总览态重绘总览');
});

test('window resize 触发书页重绘,而非只挪工具条', () => {
  const b = block('const onWindowResize');
  assert.match(b, /positionElementToolbar\(\)/);
  assert.match(b, /debouncedRepaint\(\)/, 'resize 必须重绘书页,不能只挪工具条');
});

test('ResizeObserver 跟随 book-stage 容器尺寸(聊天面板 resize/折叠改 inset → book 缩)', () => {
  assert.match(src, /new ResizeObserver\(debouncedRepaint\)/);
  assert.match(src, /\.observe\(stage\)/);
});
