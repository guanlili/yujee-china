import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

/* ════════════════════════════════════════════════════════════════════════════
   导出截图前的 cover 摊平 pass 接线守卫(2026-08-02)。

   背景:html2canvas-pro@2.0.4 渲染 object-fit:cover 的 <img> 时忽略
   object-position —— 真实 Chrome 对照实验坐实(同图 50% 0% 与 50% 100% 两个框,
   屏幕截图不同、html2canvas 输出逐像素相同;摊平成纯几何后输出与屏幕一致)。
   用户调过的照片位置因此在导出里整体回默认,这是用户上报的真实缺陷。

   摊平数学(coverContentBox)与屏幕渲染同一套 cover 推导,单测钉死与
   coverCropFraction 互逆(见 image-edit-util.test.ts)。这里 pin 接线本身:
   pass 必须存在、必须在 html2canvas 之前跑、必须只动离屏 host。
   ════════════════════════════════════════════════════════════════════════════ */

const src = readFileSync(new URL('./render-raster.ts', import.meta.url), 'utf8');

test('导出截图前必须先摊平 cover(html2canvas 忽略 object-position 的绕行)', () => {
  assert.match(src, /async function flattenCoverImagesForCapture\(/);
  assert.match(src, /coverContentBox\(/, '几何来自与屏幕同源的纯函数,不自己另算一套');
  const flatten = src.indexOf('await flattenCoverImagesForCapture(host)');
  const capture = src.indexOf('return await html2canvas(host');
  assert.ok(flatten > 0, '截图路径必须调用摊平 pass');
  assert.ok(capture > flatten, '摊平必须发生在 html2canvas 之前');
});

test('摊平只动离屏 host,先等图片解码;旋转图把偏移折进 transform 链尾', () => {
  const body = src.slice(
    src.indexOf('async function flattenCoverImagesForCapture('),
    src.indexOf('export interface FaceRenderOptions'),
  );
  assert.match(body, /host\.querySelectorAll/, '作用域限定在离屏 host');
  assert.match(body, /img\.decode\(\)/, '摊平要读 naturalWidth,先等解码');
  assert.match(body, /rotate\(\$\{rotate\}deg\) translate\(/, '旋转图的内容偏移在旋转坐标系里补');
  assert.match(body, /objectFit = 'fill'/, 'cover 语义摊平后必须退场,不给 h2c 再错一次的机会');
});
