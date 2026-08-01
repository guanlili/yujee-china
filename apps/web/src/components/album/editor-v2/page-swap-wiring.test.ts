import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

/* ════════════════════════════════════════════════════════════════════════════
   整页交换(「调整页序」模式)的接线守卫。纯逻辑的对错在 page-swap.test.ts;
   这里 pin 的是接线上的**共存条件**:
     · 合法性/置换必须来自共享的 page-swap.ts,两端不许各写一套
     · 模式内照片级手势(选图/pan/图片交换)必须让路,模式外一切照旧
     · 落库走原子 reorder 端点(一份置换一个事务),失败必须回滚本地
     · renderOverview 整体重建 innerHTML —— 模式状态必须能在重建后重刷
   ════════════════════════════════════════════════════════════════════════════ */

const here = dirname(fileURLToPath(import.meta.url));
const read = (...p: string[]) => readFileSync(join(here, ...p), 'utf8');

const editor = read('EditorPort.tsx');
const desktopCss = read('editor-port.css');

test('桌面:合法性与置换来自共享的 page-swap,不自己算', () => {
  assert.match(editor, /from '\.\/page-swap'/);
  assert.match(editor, /swapUnitOfPage\(/);
  assert.match(editor, /buildSwapPermutation\(/);
  assert.match(editor, /pairUnitOfPage\(/, '大页选中时对页整体作为落点');
});

test('桌面:入口按钮存在且挂在 actions 表上', () => {
  assert.match(editor, /id="pageSwapBtn"/);
  assert.match(editor, /data-action="togglePageSwap"/);
  assert.match(editor, /togglePageSwap: \(\) => setPageSwapMode\(!pageSwapOn\)/);
});

test('桌面:模式内照片级手势让路,模式外不受影响', () => {
  // 图片交换的按下入口直接短路
  assert.match(editor, /if \(pageSwapOn\) return; \/\/ 页序模式内,照片级手势整体让路/);
  // 画布点击委托里,模式分支必须先于 surfaceClick(普通选页/编辑链路)
  const click = editor.indexOf("ovGridEl?.addEventListener('click'");
  assert.ok(click > 0);
  const body = editor.slice(click, click + 1200);
  const modeBranch = body.indexOf('if (pageSwapOn)');
  const surface = body.indexOf('surfaceClick(host, e)');
  assert.ok(modeBranch > 0 && surface > 0 && modeBranch < surface, '模式分支在 surfaceClick 之前');
});

test('桌面:进入模式清编辑残留,Esc/切回预览强制退出', () => {
  const enter = editor.indexOf('function setPageSwapMode(');
  assert.ok(enter > 0);
  const body = editor.slice(enter, enter + 700);
  assert.match(body, /clearImageSelection\(\)/);
  assert.match(body, /hideElementToolbar\(\)/);
  assert.match(body, /cancelSwapPending\(\)/, '半途的图片交换候选一并作废');
  // Esc:图片交换拖动优先吃掉,否则退出页序模式
  assert.match(editor, /if \(pageSwapOn\) \{\s*\n\s*e\.stopPropagation\(\);\s*\n\s*setPageSwapMode\(false\);/);
  // 切回预览不把模式态带过去
  const exit = editor.indexOf('function exitOverview(');
  assert.match(editor.slice(exit, exit + 300), /setPageSwapMode\(false\)/);
});

test('桌面:落库走原子 reorder 端点,失败回滚本地页序', () => {
  const commit = editor.indexOf('async function commitPageSwap(');
  assert.ok(commit > 0);
  const body = editor.slice(commit, commit + 1400);
  assert.match(body, /pages\/reorder/);
  assert.match(body, /JSON\.stringify\(\{ permutation: perm \}\)/);
  // 乐观更新在前,失败必须回滚 + 重绘,不留半交换态
  assert.match(body, /const prev = pagesState/);
  assert.match(body, /pagesState = prev/);
  const rollback = body.indexOf('pagesState = prev');
  assert.match(body.slice(rollback, rollback + 300), /repaintBook\(\)/);
  // 整本重绘,不走脏页快路(与图片交换同一先例)
  assert.doesNotMatch(body, /repaintPages\(/);
});

test('桌面:renderOverview 重建 innerHTML 后重刷模式标注', () => {
  const start = editor.indexOf('function renderOverview()');
  assert.ok(start > 0);
  const body = editor.slice(start, editor.indexOf('function enterOverview()', start));
  assert.match(body, /applyPageSwapMarks\(\)/);
});

test('桌面:非法目标压暗但不关 pointer-events —— 点击拦截在 JS 里', () => {
  const dim = /\.editor-port \.ov-page\.pswap-dim\{([^}]*)\}/.exec(desktopCss)?.[1] ?? '';
  assert.ok(dim.length > 0, '应该有 .pswap-dim 规则');
  assert.doesNotMatch(dim, /pointer-events/, '关了 pointer-events,点非法格会穿透到空白把选中清掉');
  assert.match(desktopCss, /\.editor-port \.ov-page\.pswap-sel\{/);
});
