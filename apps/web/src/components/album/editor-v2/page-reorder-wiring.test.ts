import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

/* 页序弹窗(2026-08-02 设计)的接线守卫。纯逻辑对错在 page-reorder.test.ts;
   这里 pin 接线上的共存条件:
     · 合法缝隙/置换必须来自共享 page-reorder.ts,两端不许各写一套
     · 「完成」是唯一的 reorder 发射点(每端一个 fetch 调用点),恒等短路零请求
     · 手势口径:桌面超 slop 立即拾起,移动端长按 SWAP_LONG_PRESS_MS 拾起
     · 旧点选式交换(page-swap/pswap)不复存在 */

const here = dirname(fileURLToPath(import.meta.url));
const read = (...p: string[]) => readFileSync(join(here, ...p), 'utf8');

const editor = read('EditorPort.tsx');
const desktopCss = read('editor-port.css');
const mobileRoot = read('mobile', 'MobileEditorRoot.tsx');
const mobileEditor = read('mobile', 'MobileEditor.tsx');
const mobileStrip = read('mobile', 'MobileStrip.tsx');
const mobileCss = read('mobile', 'mobile-editor.css');
const moreSheet = read('mobile', 'modals', 'MoreSheet.tsx');
const reorderSheet = read('mobile', 'modals', 'ReorderSheet.tsx');

test('三处消费端的合法缝隙/置换都来自共享 page-reorder', () => {
  assert.match(editor, /from '\.\/page-reorder'/);
  assert.match(reorderSheet, /from '\.\.\/\.\.\/page-reorder'/);
  assert.match(mobileStrip, /from '\.\.\/page-reorder'/);
  for (const src of [editor, reorderSheet, mobileStrip]) {
    assert.match(src, /legalGaps\(/);
    assert.match(src, /applyMove\(/);
    assert.match(src, /buildInsertPermutation\(/);
    assert.match(src, /gapFromPointer\(/);
  }
});

test('桌面:入口在选中页气泡(elBar page 组),完成才发一次 reorder,恒等短路', () => {
  assert.match(editor, /data-edit-action="reorder-open"/);
  assert.match(editor, /if \(action === 'reorder-open'\)/);
  assert.doesNotMatch(editor, /id="pageReorderBtn"/, '工具栏常驻按钮已退场(2026-08-02 迭代)');
  assert.match(editor, /confirmPageReorder: \(\) => void confirmPageReorder\(\)/);
  const fetches = editor.match(/pages\/reorder/g) ?? [];
  assert.equal(fetches.length, 1, '桌面只允许 confirmPageReorder 一个发射点');
  assert.match(editor, /if \(!perm\) return; \/\/ 恒等:零请求/);
});

test('移动端预览栏:长按直接拖拽换序,滚动共存,拖完吞 click', () => {
  assert.match(mobileStrip, /SWAP_LONG_PRESS_MS/);
  assert.match(mobileStrip, /SWAP_LONG_PRESS_SLOP/);
  assert.match(mobileStrip, /passive: false/, '拾起后靠非 passive touchmove 拦浏览器平移');
  assert.match(mobileStrip, /suppressUntilRef/, '拖完的 click 走时间窗抑制(真拖不一定补发 click,布尔标记会吞掉下一次无辜点按)');
  assert.match(mobileStrip, /d\.lifted && d\.moved/, '只有真拖过才吞 click/算落点 —— 原地松手回落普通点击,不留死区(2026-08-03 真机回归)');
  assert.match(mobileStrip, /isAnchoredTemplate\(/, '锚定页拾不起来');
  assert.match(mobileRoot, /onReorder=\{commitReorder\}/, '落库复用容器层同一条乐观+回滚通道');
});

test('移动端:主菜单入口 → ReorderSheet,完成才发一次 reorder', () => {
  assert.match(moreSheet, /data-testid="more-reorder"/);
  assert.match(moreSheet, /onReorderPages/);
  assert.match(mobileRoot, /<ReorderSheet/);
  const fetches = mobileRoot.match(/pages\/reorder/g) ?? [];
  assert.equal(fetches.length, 1, '移动端只允许 commitReorder 一个发射点');
  assert.match(reorderSheet, /if \(perm\) onCommit\(perm\)/, '恒等不上报');
});

test('手势口径:桌面超 slop 立即拾起,移动端长按拾起、动了回落滚动', () => {
  assert.match(editor, /SWAP_LONG_PRESS_SLOP\) return;/);
  assert.doesNotMatch(editor, /preorder[\s\S]{0,400}?SWAP_LONG_PRESS_MS/, '桌面弹窗无长按仲裁');
  assert.match(reorderSheet, /SWAP_LONG_PRESS_MS/);
  assert.match(reorderSheet, /SWAP_LONG_PRESS_SLOP/);
});

test('失败回滚:两端提交失败都回滚本地并提示', () => {
  assert.match(editor, /pageReorderFailed/);
  assert.match(mobileRoot, /页序没有存上/);
});

test('旧点选式交换不复存在', () => {
  for (const [name, src] of [
    ['EditorPort', editor],
    ['editor-port.css', desktopCss],
    ['MobileEditorRoot', mobileRoot],
    ['MobileEditor', mobileEditor],
    ['MobileStrip', mobileStrip],
    ['mobile-editor.css', mobileCss],
  ] as const) {
    assert.doesNotMatch(src, /pswap/, `${name} 不得残留 pswap`);
    assert.doesNotMatch(src, /page-swap'/, `${name} 不得再引 page-swap 模块`);
    assert.doesNotMatch(src, /PageSwapUnit/, `${name} 不得残留交换单位类型`);
  }
});

test('锚定页:两端格子都锁(不可拖起)', () => {
  assert.match(editor, /preorder-locked/);
  assert.match(reorderSheet, /preorder-locked/);
  assert.match(editor, /isAnchoredTemplate\(/);
  assert.match(reorderSheet, /isAnchoredTemplate\(/);
});

test('结构 OCC(Phase 2A):两端 reorder 带 baseStructureRevision、读回推进、409 冲突回滚+重载提示', () => {
  // 桌面:POST body 带基线,成功读回推进,409 冲突回滚并给整书重载出口。
  assert.match(editor, /baseStructureRevision: bookStructureRevision/);
  assert.match(editor, /bookStructureRevision = json\.data\.structureRevision/);
  assert.match(editor, /STRUCTURE_CONFLICT/);
  // 移动端:commitReorder 带基线,成功读回推进 ref,409 冲突回滚 + 「结构已变化」提示。
  assert.match(mobileRoot, /baseStructureRevision: baseline/);
  assert.match(mobileRoot, /structureRevisionRef\.current = json\.data\.structureRevision/);
  assert.match(mobileRoot, /STRUCTURE_CONFLICT/);
  assert.match(mobileRoot, /结构已变化/);
});

test('结构入口不对 editor 隐藏:移动端重排入口不再因 isOwner 关掉', () => {
  assert.doesNotMatch(mobileRoot, /onReorderPages=\{isOwner \?/);
  // 桌面入口本就挂在选中页气泡(edit bar)里,不经 isOwner 条件。
  assert.match(editor, /data-edit-action="reorder-open"/);
});
