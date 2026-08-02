import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

/* ════════════════════════════════════════════════════════════════════════════
   长按拖拽交换图片的接线守卫(桌面 + 移动)。

   这个功能踩的是一块已经有主人的地:图槽上的直接拖动,桌面是「在框内平移画面」,
   移动端没选中时是翻页、选中后同样是平移。所以下面这几条不是风格偏好,是**它能不能
   同时存在**的条件:
     · 进入动作必须是长按,且拾起前抖过 slop 就取消(否则平移/翻页当场失灵)
     · 幽灵必须 pointer-events:none(否则落点判定只会命中幽灵自己)
     · 落地只动 imagesJson,不碰 html(html 里是 {{IMG_SRC:slot}} token)
     · 两侧的页各发一次单页 PATCH(服务端 images 分支是整体替换)
   ════════════════════════════════════════════════════════════════════════════ */

const here = dirname(fileURLToPath(import.meta.url));
const read = (...p: string[]) => readFileSync(join(here, ...p), 'utf8');

const editor = read('EditorPort.tsx');
const desktopCss = read('editor-port.css');
const editView = read('mobile', 'EditView.tsx');
const mobileRoot = read('mobile', 'MobileEditorRoot.tsx');
const mobileCss = read('mobile', 'mobile-editor.css');

test('两端共用同一份交换语义,不各写一套', () => {
  for (const [name, src] of [
    ['EditorPort', editor],
    ['MobileEditorRoot', mobileRoot],
  ] as const) {
    assert.match(src, /from '\.{1,2}\/image-swap'/, `${name} 必须用共享的 image-swap`);
    assert.match(src, /swapImageSlots\(/, `${name} 落地要走 swapImageSlots`);
  }
  assert.match(editView, /SWAP_LONG_PRESS_MS/, '移动端的长按阈值也来自那一份');
  assert.match(editView, /exceedsLongPressSlop\(/);
});

test('两端统一长按拾起:快拖回落 pan/平移,按住不动才是交换(2026-08-01 拍板)', () => {
  // bf899f76 曾给鼠标开过「一动就拾起」的快路(理由是拖图=挪图更顺手),代价当时
  // 没看见:拾起时 beginSwapDrag 清选中态,pan 的 `!imgEdit` 守卫当场失效 ——
  // 选中照片后的拖动调位(pan)被整个劫走,桌面鼠标 pan 等于死了。pan 是构图微调的
  // 唯一入口,优先级高于交换的顺手程度;桌面回到与触屏同一条长按计时路径,
  // 快拖(350ms 内越过 slop)一律取消拾起,回落普通手势(选中 → pan,未选中 → 画布平移)。
  assert.doesNotMatch(editor, /immediate = e\.pointerType/, '鼠标立即拾起的快路不许回来');
  assert.doesNotMatch(editor, /pending\.immediate/, 'pending 不再有 immediate 分支');
  // 两端同一条计时路径
  assert.match(editor, /timer: window\.setTimeout\(\(\) => beginSwapDrag\([^)]*\),\s*SWAP_LONG_PRESS_MS\)/);
  // 越过 slop 一律放弃拾起
  assert.match(editor, /if \(!moved\) return;\n\s*\/\/[^\n]*\n\s*cancelSwapPending\(\);/);
});

test('桌面:画布上不再有照片拖拽调位 —— 位置调整住进浮层预览(2026-08-02 定稿)', () => {
  // pan 与长按交换在同一块画布上试过两版分流(鼠标立即拾起 → pan 被劫走;
  // 时间门 8px/350ms → 微调中的停顿被误判为长按),都失败:根因是同一块画布
  // 同时住着两个拖拽语义。定稿是空间切分 —— 位置调整整体搬进浮层的 Figma 式
  // 预览(.img-edit-preview 内拖动),画布按下只剩「平移画布」和「长按交换」。
  assert.doesNotMatch(editor, /onImgPointerDown|onImgPointerMove|onImgPointerUp/, '画布 pan 监听不许回来');
  assert.doesNotMatch(editor, /dragToImagePos\(/, '画布拖拽换算已随 pan 一起退场(预览走 previewDragToImagePos)');
  // 长按对选中照片同样有效:让路 guard 已随冲突源头一起撤销
  const down = editor.slice(
    editor.indexOf('const onSwapPointerDown ='),
    editor.indexOf('const onSwapPointerMove ='),
  );
  assert.doesNotMatch(down, /imgEdit[^\n]*return/, '不许再给选中照片开让路 guard');
  // 移动端不在本次改版范围:编辑态不武装长按的口径保持
  assert.match(editView, /if \(!imageEditing && pressedSlot && pressedPhoto && page\)/);
});

test('桌面:浮层预览承接位置调整 —— 亮框几何走纯函数,松手走 commitImagePos', () => {
  assert.match(editor, /className = 'img-edit-preview'/);
  assert.match(editor, /className = 'img-edit-crop'/);
  assert.match(editor, /coverCropFraction\(/, '裁切几何来自 image-edit-util 纯函数(单测覆盖)');
  assert.match(editor, /previewDragToImagePos\(/);
  // 预览拖动松手必须走既有的 commitImagePos(所见即所存链路不变)
  const up = editor.indexOf("preview.addEventListener('pointerup'");
  assert.ok(up > 0);
  assert.match(editor.slice(up, up + 400), /commitImagePos\(\)/);
});

test('桌面:拾起交换时,把 pan 没提交的 live 位移放回已提交位置', () => {
  // 长按目标可能正是当前选中图:pan 的位移阈值只有 2px、commit 在松手,350ms 内
  // ≤slop 的微动已经画到 <img> 上了。拾起走的是交换,不该顺手留下一笔没提交的位移。
  const start = editor.indexOf('function beginSwapDrag(');
  assert.ok(start > 0);
  const body = editor.slice(start, editor.indexOf('function endSwapDrag(', start));
  const revert = body.indexOf('applyLiveImagePos(');
  const clear = body.indexOf('clearImageSelection()');
  assert.ok(revert > 0, '拾起时要按 imagePosJson 回放 live 样式');
  assert.match(body, /currentImagePos\(/, '回放的是已提交位置,不是丢着不管');
  assert.ok(clear > revert, '回放必须发生在清选中态之前(清完就拿不到 imgEdit 了)');
});

test('桌面:画布平移与长按拾起不打架', () => {
  // 拾起候选期间不平移画布(否则一次按住既拾起又把画布拖走)
  assert.match(editor, /if \(swapPending\) return;/);
  // 交换拖动进行中画布不动
  assert.match(editor, /if \(swapDrag\) return;/);
  // 拾起的一刻把已经起步的画布平移按下
  assert.match(editor, /ovPanning = false;/);
});

test('桌面:移动/松手挂 window 捕获阶段 —— 拖出格子、拖到另一页都要跟手', () => {
  assert.match(
    editor,
    /window\.addEventListener\('pointermove', onSwapPointerMove, \{ capture: true/,
  );
  assert.match(editor, /window\.addEventListener\('pointerup', onSwapPointerUp, true\)/);
  // 卸载必须带同样的 capture 标记,否则根本摘不掉
  assert.match(editor, /window\.removeEventListener\('pointermove', onSwapPointerMove, true\)/);
  assert.match(editor, /window\.removeEventListener\('pointerup', onSwapPointerUp, true\)/);
});

test('桌面:落地只动数据层,两页各发一次单页 PATCH', () => {
  const start = editor.indexOf('function applySlotSwap(');
  assert.ok(start > 0, 'applySlotSwap 应该存在');
  const body = editor.slice(start, start + 900);
  assert.match(body, /live\.imagesJson = next\.imagesJson/);
  // 交换动两页两个槽、可能跨跨页,脏页快路在真机上重绘不出来(数据换好了屏幕不变,
  // 刷新才显示)。用 repaintBook —— 它就是「一次编辑之后把所有显示页面内容的表面
  // 都重画一遍」,画布模式下整体 renderOverview。
  assert.match(body, /repaintBook\(\)/);
  assert.doesNotMatch(body, /repaintPages\(/, '脏页快路重绘不全,不许回来');
  assert.match(body, /persistPagePatch\(live\)/);
  assert.doesNotMatch(body, /syncPageHtml|patchHtml/, 'html 里是 token,碰了就烘死');
});

test('桌面:幽灵不吃指针事件,否则落点判定只会命中它自己', () => {
  const ghost = /\.editor-port \.img-swap-ghost\{([\s\S]*?)\}/.exec(desktopCss)?.[1] ?? '';
  assert.ok(ghost.length > 0, '应该有 .img-swap-ghost 规则');
  assert.match(ghost, /pointer-events:\s*none/);
  assert.match(ghost, /position:\s*fixed/);
  assert.match(editor, /document\.elementsFromPoint\(/, '落点按这一点上的 z 序判定');
  assert.match(desktopCss, /\.editor-port \.img-swap-target\{/, '落点要有高亮');
});

test('移动端:交换的幽灵与高亮是自己渲染的兄弟节点,不去改页面 DOM', () => {
  // 架构守卫(见 edit-view.test.ts)在这条线上同样成立:高亮不是给页面节点加类。
  assert.match(editView, /className="mswap-ghost"/);
  assert.match(editView, /className="mswap-target"/);
  assert.doesNotMatch(editView, /\.classList\.(add|remove|toggle)/);
  assert.doesNotMatch(editView, /\bdocument\./);
  const ghost = /\.mobile-editor \.mswap-ghost \{([\s\S]*?)\}/.exec(mobileCss)?.[1] ?? '';
  assert.ok(ghost.length > 0, '应该有 .mswap-ghost 规则');
  assert.match(ghost, /pointer-events:\s*none/);
});

test('移动端:拾起的一刻,平移与翻页一起让位', () => {
  const start = editView.indexOf('timer: window.setTimeout(');
  assert.ok(start > 0);
  const body = editView.slice(start, start + 700);
  assert.match(body, /imgDrag\.current = null/, '这一拖不再是平移画面');
  assert.match(body, /swipe\.current = null/, '也不再是翻页');
  assert.match(body, /moved\.current = true/, '松手那记 click 不该改选中');
});

test('移动端:跨页靠「拖到边缘停住 → 自动翻页」,且翻页用 ref 取最新的 onStep', () => {
  assert.match(editView, /edgeFlipDirection\(/);
  assert.match(editView, /setInterval\(\(\) => stepRef\.current\(dir\), SWAP_EDGE_FLIP_MS\)/);
  assert.match(editView, /stepRef\.current = onStep/, '定时器里用旧的 onStep 会一直翻同一页');
});

test('移动端:落地整份替换 pages,每张动过的页各发一次单页 PATCH', () => {
  const start = mobileRoot.indexOf('const onSwapImage =');
  assert.ok(start > 0, 'onSwapImage 应该存在');
  const body = mobileRoot.slice(start, start + 800);
  assert.match(body, /setPages\(result\.pages\)/);
  assert.match(body, /for \(const pageIndex of result\.touched\)/);
  assert.match(body, /persistPage\(pageIndex, imagesPatchBody\(next\)\)/);
  assert.match(mobileRoot, /onSwapImage=\{onSwapImage\}/, '得真的接到展示层上');
});

/* ── 幽灵泄漏(真机撞到过:画布上堆着一摞带白描边的小图)────────────────────────
   幽灵是命令式 append 的裸 DOM,**只有 swapDrag 这一个引用**。swapDrag 一旦在没走
   endSwapDrag 的情况下被覆盖/丢掉,那个节点就再也没人删得掉。而「收不到 pointerup」
   不是理论情形:鼠标拖出窗口才松手、切走标签页、pointercancel 没派发,都会走到那儿。 */

test('桌面:开新拖动前先收掉上一个 —— 直接覆盖 swapDrag 等于永久漏一个幽灵', () => {
  const start = editor.indexOf('function beginSwapDrag(');
  assert.ok(start > 0);
  const body = editor.slice(start, editor.indexOf('function endSwapDrag(', start));
  const guard = body.indexOf('if (swapDrag) endSwapDrag(false)');
  const assign = body.indexOf('swapDrag = {');
  assert.ok(guard > 0, '开新拖动前必须先收掉还挂着的那个');
  assert.ok(guard < assign, '收掉必须发生在覆盖 swapDrag 之前,否则旧引用当场丢失');
});

test('桌面:幽灵还有一条按类名的兜底清扫,不只靠引用', () => {
  assert.match(editor, /function sweepSwapArtifacts\(\)/);
  assert.match(editor, /querySelectorAll\('\.img-swap-ghost'\)[\s\S]{0,60}\.remove\(\)/);
  // 残留的选中/落点态也要一起摘,不然源图会一直半透明、落点一直亮着描边
  assert.match(editor, /classList\.remove\('img-swap-source'\)/);
  assert.match(editor, /classList\.remove\('img-swap-target'\)/);
  // 收尾与卸载都要扫
  const end = editor.indexOf('function endSwapDrag(');
  assert.match(editor.slice(end, end + 600), /sweepSwapArtifacts\(\)/);
});

test('桌面:窗口失焦 / 标签页切走 = 这一拖再也不会有 pointerup,必须作废', () => {
  assert.match(editor, /const abortSwapDrag = \(\)/);
  assert.match(editor, /window\.addEventListener\('blur', abortSwapDrag\)/);
  assert.match(editor, /document\.addEventListener\('visibilitychange', abortSwapDrag\)/);
  assert.match(editor, /window\.removeEventListener\('blur', abortSwapDrag\)/);
  assert.match(editor, /document\.removeEventListener\('visibilitychange', abortSwapDrag\)/);
});
