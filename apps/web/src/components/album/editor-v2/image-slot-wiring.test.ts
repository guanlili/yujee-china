import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

/* ════════════════════════════════════════════════════════════════════════════
   桌面「换图 / 删图」的接线守卫(#304 移动端已有,桌面补齐)。

   这两件动作最容易接错的地方不是按钮,是**改哪一层**:

   ① 存库 html 的图片位是 `{{IMG_SRC:slot}}` token,显示时按 imagesJson 现查现解析。
      换图/删图只改数据层就够了 —— 顺手 patch 一下 html 反而会把 token 烘死成某张
      具体照片,以后再也换不动。服务端 updatePage 的 images 分支同口径。

   ② 反过来,**框位(平移/缩放)只活在 html 的行内 style 里**,imagePosJson 只是
      落库副本。所以删图要抹掉旧框位时,必须发一份 DEFAULT 过去(html patcher 只
      遍历 patch 里出现的槽),光把 key 删了服务端那侧根本不会被调到,旧的
      object-position/transform 会留在 html 里 —— 下次往这个槽放新图就继承了上一张
      的构图,看着像放歪了。

   两条都是「界面上点着好像好了、刷新才发现不对」的洞,靠点界面点不出来。
   ════════════════════════════════════════════════════════════════════════════ */

const here = dirname(fileURLToPath(import.meta.url));
const read = (...p: string[]) => readFileSync(join(here, ...p), 'utf8');
const editorPort = read('EditorPort.tsx');
const css = read('editor-port.css');
const coordinator = read('editor-coordinator.ts');

/** 取一个函数体(到同缩进的收尾大括号为止)。 */
function funcBody(name: string): string {
  const m = editorPort.match(new RegExp(`\\n    function ${name}\\([^)]*\\)[^{]*\\{[\\s\\S]*?\\n    \\}`));
  assert.ok(m, `${name} should exist in the EditorBook effect`);
  return m[0];
}

test('图片浮层带齐五件:缩放 / 平移 / 复位 / 换图 / 删除', () => {
  const build = funcBody('buildImgEditOverlay');
  for (const cls of ['img-edit-zoom', 'img-edit-reset', 'img-edit-swap', 'img-edit-del']) {
    assert.match(build, new RegExp(`\\.className = '${cls}'`), `浮层缺 ${cls}`);
    assert.match(css, new RegExp(`\\.editor-port \\.${cls}`), `${cls} 没有样式`);
  }
  assert.match(build, /openPhotoSwap\(\)/, '「换图」必须开换图选择器');
  assert.match(build, /clearImageSlot\(\)/, '「删除」必须清空图槽');
});

test('换图只动数据层 —— 不碰 html,也不动位置/缩放', () => {
  const swap = funcBody('swapImage');
  assert.match(swap, /page\.imagesJson = \{ \.\.\.page\.imagesJson, \[slotId\]: photoId \}/, '换图 = 把图槽指到另一张照片');
  assert.doesNotMatch(swap, /syncPageHtml/, '换图不许 patch html(会把 {{IMG_SRC}} token 烘死)');
  assert.doesNotMatch(swap, /imagePosJson/, '换的是内容不是版面:位置/缩放留给新图沿用');
  assert.match(swap, /repaintPages\(\[pageIndex\]\)/, '换完要重绘(token 到这时才解析到新照片)');
  assert.match(swap, /persistPagePatch\(page\)/, '落库走与改字同一条单页 PATCH');
});

test('删图清 key + 把框位抹回默认(必须发 DEFAULT,不能只删 key)', () => {
  const clear = funcBody('clearImageSlot');
  assert.match(clear, /delete nextImages\[slotId\]/, '删 key 而不是置空串(空串是指向「空照片」的假记录)');
  assert.match(
    clear,
    /page\.imagePosJson = \{ \.\.\.\(page\.imagePosJson \?\? \{\}\), \[slotId\]: \{ \.\.\.DEFAULT_IMAGE_POS \} \}/,
    '框位要发 DEFAULT 过去,服务端才会把 html 里的旧 object-position/transform 抹掉',
  );
  assert.match(
    clear,
    /syncPageHtml\(page, \(html\) => patchHtmlImagePos\(html, slotId, DEFAULT_IMAGE_POS\) \?\? html\)/,
    '本地 html 真相也要同步复位(patch 失败保留原 html,不丢整页真相),否则重绘当场把旧框位画回来',
  );
  assert.match(clear, /clearImageSelection\(\);\n\s*repaintPages/, '先收浮层再重绘 —— 否则 reattachImgEdit 会把浮层接回一个空 <img>');
  assert.match(clear, /persistPagePatch\(page\)/, '落库走与改字同一条单页 PATCH');
});

test('换图选择器挂进了弹窗层、扫描域和关闭出口', () => {
  assert.match(editorPort, /id="photoSwapModal"/, '换图选择器要有自己的 modal-overlay');
  assert.match(editorPort, /id="swapGrid"/, '照片网格容器');
  // 「按钮绑不上」这条改由 modal-action-wiring.test.ts 统一守(手工白名单已删除)。
  assert.match(editorPort, /^\s*closePhotoSwap,$/m, 'closePhotoSwap 必须登记进 actions');
  assert.match(editorPort, /\['photoSwapModal', closePhotoSwap\]/, '点背景要能关掉');
  // 选择器不复用 pickGrid(那是「创建分组」那套,带多选 + 确认按钮)。换图是可逆动作,
  // 点一张即换即关,没有确认步骤 —— 与移动端 PhotoPickerSheet 同一口径。
  assert.doesNotMatch(funcBody('buildSwapGrid'), /createChBtn|updatePickCount/, '换图选择器不该沾上分组选择器的确认流程');
});

test('换图选择器的文案两种语言都有(缺了会把 i18n key 直接显示出来)', () => {
  for (const key of ['swapTitle', 'swapSub', 'swapCancel', 'swapEmpty']) {
    const hits = coordinator.match(new RegExp(`\\n\\s*${key}:`, 'g')) ?? [];
    assert.equal(hits.length, 2, `${key} 应该在 zh 和 en 两份字典里各有一条`);
  }
});
