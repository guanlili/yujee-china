import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// 画板中线补偿(2026-07-15):聊天面板是 position:fixed 的左侧浮层(脱离文档流),
// 书用 flex 居中会偏到面板底下。--canvas-inset(ChatPanel 按面板实时宽度维护,
// 默认 0)让 book-stage / 底部居中 pill / 顶部提示条右移,居中于面板右侧的可见区。
// 默认 0 保证 JS 没跑时布局等同旧版 —— 零回归。

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'editor-port.css'), 'utf8');
const chat = readFileSync(join(here, 'ChatPanel.tsx'), 'utf8');

function rule(selector: string): string {
  const at = css.indexOf(selector + '{');
  assert.ok(at > -1, `${selector} rule must exist`);
  return css.slice(at, css.indexOf('}', at));
}

test('book-stage 左 padding 消费 --canvas-inset(书居中于面板右侧可见区)', () => {
  // book-stage 的样式分散在两条规则,padding-left 是全局唯一(只有 book-stage 用),
  // 直接匹配这条即可。
  assert.match(css, /padding-left:\s*calc\(16px \+ var\(--canvas-inset[^)]*\)\)/);
});

test('底部居中 pill 与顶部提示条按 50% + inset/2 居中', () => {
  assert.match(rule('.editor-port .zoom-ctrl'), /left:\s*calc\(50% \+ var\(--canvas-inset[^)]*\) \/ 2\)/);
  assert.match(rule('.editor-port .canvas-hint'), /left:\s*calc\(50% \+ var\(--canvas-inset[^)]*\) \/ 2\)/);
});

test('--canvas-inset 有默认 0 兜底(JS 没跑时零回归)', () => {
  // 三处消费都用 var(--canvas-inset, 0px),缺省即退化为旧版全视口居中。
  assert.match(css, /var\(--canvas-inset, 0px\)/);
});

test('ChatPanel 按面板 drag/resize/fold/视口变化维护 --canvas-inset', () => {
  assert.match(chat, /setProperty\('--canvas-inset'/);
  assert.match(chat, /new ResizeObserver\(updateCanvasInset\)/);
  assert.match(chat, /new MutationObserver\(updateCanvasInset\)/);
  // 折叠 / 移动端 / 拖到右半区 => 0(不补偿)。
  assert.match(chat, /chat-collapsed'\)\) return 0/);
});
