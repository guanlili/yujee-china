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

test('长按拾起:桌面 1s / 移动 350ms,快拖一律回落普通手势', () => {
  // bf899f76 曾给鼠标开过「一动就拾起」的快路,拾起时清选中态把编辑手势整个劫走 ——
  // 立即拾起不许回来。阈值两端分开(2026-08-02 拍板):桌面单击已经承担「弹编辑卡」,
  // 350ms 会把慢一点的点击误判成拾起,放宽到 1s(桌面没有系统长按手势要避);
  // 移动端保持 350ms,要抢在 iOS 长按菜单(~500ms)之前。
  assert.doesNotMatch(editor, /immediate = e\.pointerType/, '鼠标立即拾起的快路不许回来');
  assert.doesNotMatch(editor, /pending\.immediate/, 'pending 不再有 immediate 分支');
  assert.match(editor, /timer: window\.setTimeout\(\(\) => \{[\s\S]{0,400}?beginSwapDrag\([^)]*\);\s*\n\s*\}, SWAP_LONG_PRESS_DESKTOP_MS\)/);
  assert.doesNotMatch(editor, /SWAP_LONG_PRESS_MS\)/, '桌面不许用移动端的 350ms');
  // 越过 slop 一律放弃拾起
  assert.match(editor, /if \(!moved\) return;\n\s*\/\/[^\n]*\n\s*cancelSwapPending\(\);/);
});

test('桌面:编辑卡绝不压在照片上 —— 下/上/右/左依次找空位(2026-08-02 用户复测)', () => {
  // 卡片长高后压在图上,被盖住的区域既看不到调位效果,长按(交换)也落不到照片。
  const start = editor.indexOf('function positionImgEditOverlay(');
  assert.ok(start > 0);
  const body = editor.slice(start, editor.indexOf('function selectImage(', start));
  assert.match(body, /r\.bottom \+ gap/, '首选图框下方');
  assert.match(body, /r\.top - gap - h/, '下方不够放上方');
  assert.match(body, /r\.right \+ gap/, '上下都不够放右侧');
  assert.match(body, /r\.left - gap - w/, '再不够放左侧');
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
  // 画布平移只在「什么都没选中」时武装(2026-08-02 用户定稿):选中了页/图/文字后,
  // 拖动语义属于选中对象(长按交换/预览调位),画板跟着动只会把交换拖动搅黄。
  // 没选中时照片上快拖照样平移(死区教训:按目标分流会把快拖变成什么都不动)。
  const down = editor.slice(
    editor.indexOf('const onOvPointerDown ='),
    editor.indexOf('const onOvPointerMove ='),
  );
  assert.match(down, /selectedPageIndex == null && imgEdit == null && editBarAnchor == null/);
  assert.doesNotMatch(down, /swapPickAt/, '按下侧不许按目标分流平移(死区教训)');
});

test('桌面:拾起交换清场所有编辑面;拖动存续期间点击打不开编辑卡', () => {
  // 真机截图(2026-08-02):幽灵和编辑卡同框。两头都堵:拾起时收掉图片卡 + 文字
  // 工具条;万一还有(僵尸)拖动挂着,selectImage 直接拒绝。
  const begin = editor.slice(
    editor.indexOf('function beginSwapDrag('),
    editor.indexOf('let swallowClick'),
  );
  assert.match(begin, /clearImageSelection\(\)/);
  assert.match(begin, /hideElementToolbar\(\)/);
  const sel = editor.slice(
    editor.indexOf('function selectImage('),
    editor.indexOf('function clearImageSelection('),
  );
  assert.match(sel, /if \(swapDrag\) return;/);
});

test('桌面:三态选中视觉分离 —— 页 teal / 图 --sel-image / 文字 --sel-text,图层选中时页框让位', () => {
  assert.match(desktopCss, /img\.img-editing\{\s*outline:3px solid var\(--sel-image\)/);
  assert.match(desktopCss, /\.el-text-selected\{[^}]*var\(--sel-text\)/);
  // 图层选中时页框让位:同屏永远只有一个主选中框,不用猜「现在选的是页还是图」。
  assert.match(editor, /const layerActive =/);
  assert.match(editor, /!layerActive && pi !== undefined/);
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

test('桌面:拾起零弹出 —— 幽灵懒创建,静止长按不凭空弹缩略图;松手无条件毙候选', () => {
  // 真机连报两次「悬停/长按 1s 凭空弹出可拖动样式」:一半是拾起瞬间弹幽灵的
  // 视觉(按住没动它也弹),一半是候选取消只认 pointerId 判等 —— id 对不上的 up
  // 会让计时器活过松手。两个都封死:
  const begin = editor.slice(
    editor.indexOf('function beginSwapDrag('),
    editor.indexOf('let swallowClick'),
  );
  assert.doesNotMatch(begin, /createElement\('div'\)/, '拾起那一刻不许创建幽灵');
  assert.match(editor, /function ensureSwapGhost\(/, '幽灵在首次移动时才出现');
  assert.match(editor, /primarySwapPointerDown/, '计时器到点先核验主键还按着');
  const up = editor.slice(
    editor.indexOf('const onSwapPointerUp ='),
    editor.indexOf('const onSwapPointerCancel ='),
  );
  assert.doesNotMatch(up, /swapPending\?\.pointerId === e\.pointerId\) cancelSwapPending/, '取消候选不许再看 pointerId');
  assert.match(up, /cancelSwapPending\(\);/, '松手就是松手,无条件取消');
});

test('桌面:僵尸拖动三层防线 —— 原生拖拽掐掉、无键移动自愈、新按下作废旧拖动', () => {
  // 真机撞到(2026-08-02):浏览器对 <img> 的原生拖拽接管指针流后 pointerup 不再
  // 派发,幽灵成了跟着鼠标走的僵尸;更糟的是僵尸挂着时的下一次单击,松手会误提交
  // 一次交换。三层各自独立成立,谁都不许被"优化"掉:
  assert.match(editor, /bodyEl\.addEventListener\('dragstart', onNativeDragStart, true\)/, '① 源头:编辑器根上掐掉原生拖拽');
  assert.match(editor, /bodyEl\.removeEventListener\('dragstart', onNativeDragStart, true\)/, '卸载也要摘');
  assert.match(editor, /e\.pointerType === 'mouse' && e\.buttons === 0/, '② 自愈:无键移动 = up 丢了,拖动作废');
  assert.match(editor, /if \(swapDrag && e\.isPrimary\) endSwapDrag\(false\)/, '③ 兜底:新主指针按下作废僵尸,不许让松手误提交');
});

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
