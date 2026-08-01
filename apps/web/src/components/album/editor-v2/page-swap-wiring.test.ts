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
const mobileRoot = read('mobile', 'MobileEditorRoot.tsx');
const mobileEditor = read('mobile', 'MobileEditor.tsx');
const mobileStrip = read('mobile', 'MobileStrip.tsx');
const mobileCss = read('mobile', 'mobile-editor.css');

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

test('移动端:合法性与置换来自共享 page-swap,落库同一原子端点,失败回滚', () => {
  assert.match(mobileRoot, /from '\.\.\/page-swap'/, '不许自己再算一套');
  assert.match(mobileRoot, /buildSwapPermutation\(/);
  assert.match(mobileRoot, /pages\/reorder/);
  // 乐观更新 + 失败回滚(setPages 回旧引用),不留半交换态
  const commit = mobileRoot.indexOf('const commitPageSwap =');
  assert.ok(commit > 0);
  const body = mobileRoot.slice(commit, commit + 1200);
  assert.match(body, /const prev = pages/);
  assert.match(body, /setPages\(prev\)/);
});

test('移动端:模式态住容器层,展示层只拿算好的三态(不碰 document)', () => {
  assert.match(mobileRoot, /pageSwapFaceState/);
  assert.match(mobileEditor, /swap=\{pageSwap\}/, 'MobileEditor 把模式透传给预览栏');
  assert.match(mobileEditor, /onClick=\{onPageSwapToggle\}/, '入口开关真的接上了');
  assert.doesNotMatch(mobileStrip, /\bdocument\.|classList\./, '预览栏保持纯 React 渲染');
});

test('移动端:预览栏小面在模式内可点,且不串到跳页', () => {
  assert.match(mobileStrip, /data-pswap=\{swap \? swap\.faceState\(pi\) : undefined\}/);
  assert.match(mobileStrip, /e\.stopPropagation\(\)/, '点面不该同时触发格子的 onJump');
  // 常态 face 是 pointer-events:none;模式内必须放开,否则点击根本到不了 face
  const off = /\.mobile-editor \.mstrip-face \{([^}]*)\}/.exec(mobileCss)?.[1] ?? '';
  assert.match(off, /pointer-events:\s*none/, '前提变了的话这条测试要重写');
  const on = /\.mobile-editor \.mstrip-face\[data-pswap\] \{([^}]*)\}/.exec(mobileCss)?.[1] ?? '';
  assert.match(on, /pointer-events:\s*auto/);
  assert.match(mobileCss, /\.mstrip-face\[data-pswap='sel'\]/);
  assert.match(mobileCss, /\.mstrip-face\[data-pswap='dim'\]/);
});
