import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { shouldDismissFilterPanel } from './filter-controller';

/* 选完滤镜、鼠标点到别处 → 面板该自己收起。
   桌面原先只有 × 能关,面板会一直挂在画布上挡视线(移动端那份是 bottom-sheet,
   ModalHost 早就有「点遮罩关闭」)。 */

const here = dirname(fileURLToPath(import.meta.url));
const read = (...p: string[]) => readFileSync(join(here, ...p), 'utf8');

/** 造一个只认 selector 前缀的假节点:够测 closest 分支,不用 jsdom。 */
const node = (...ancestors: string[]) =>
  ({
    closest: (sel: string) => (ancestors.includes(sel) ? {} : null),
  }) as unknown as EventTarget;

test('点面板内部不收起 —— 选滤镜/拖强度/翻页都在里面', () => {
  assert.equal(shouldDismissFilterPanel(node('.filter-bar')), false);
});

test('点「风格」按钮本身不收起 —— 否则一次点击又收又开,表现是点了没反应', () => {
  assert.equal(shouldDismissFilterPanel(node('.img-edit-style')), false);
});

test('点画布/别的照片/工具条 → 收起', () => {
  assert.equal(shouldDismissFilterPanel(node('.ov-page')), true);
  assert.equal(shouldDismissFilterPanel(node('.img-edit-overlay')), true);
  assert.equal(shouldDismissFilterPanel(node()), true);
});

test('拿不到 closest 的目标(document/window)按「点到别处」算,不留死面板', () => {
  assert.equal(shouldDismissFilterPanel(null), true);
  assert.equal(shouldDismissFilterPanel({} as EventTarget), true);
});

test('桌面接线:面板开着时挂全局监听,关掉时摘掉', () => {
  const editor = read('EditorPort.tsx');
  assert.match(editor, /shouldDismissFilterPanel/, '判据走共享纯函数,不在组件里手搓 closest');
  assert.match(
    editor,
    /if \(!filterOpen\) return;/,
    '只在面板开着时挂监听,免得常驻一个全局 pointerdown',
  );
  assert.match(editor, /removeEventListener\('pointerdown', onDocPointerDown, true\)/);
  assert.match(editor, /key === 'Escape'/, 'Esc 也该收起');
});
