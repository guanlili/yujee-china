import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

/* ════════════════════════════════════════════════════════════════════════════
   导出截图前的 cover 摊平 pass 接线守卫(2026-08-02 v1;2026-08-03 v2 泛化)。

   背景:html2canvas-pro@2.0.4 渲染 object-fit:cover 的 <img> 时忽略
   object-position —— 真实 Chrome 对照实验坐实(同图 50% 0% 与 50% 100% 两个框,
   屏幕截图不同、html2canvas 输出逐像素相同)。用户调过的照片位置因此在导出里
   整体回默认,这是用户上报的真实缺陷。

   v2 教训(2026-08-03 用户上报「调过显示区域的图导出全变形」):v1 从行内样式
   正则读 x/y/scale 只认编辑器写的窄格式,AI 手写页的 class 样式/关键字与 px
   定位/translate 链全被读歪,裸 img 被「放大+绝对定位」后失去裁切。v2 改为按
   计算样式复算可见窗口、预烘位图换 src,布局一个字不动;几何忠实性由真实浏览器
   取证钉死(native vs 导出 12 用例 ≤1px,含 class/keyword/px 定位、translate 链、
   scale(140%)、裸 img、盒交换旋转)。这里 pin 接线本身:pass 必须存在、必须在
   html2canvas 之前跑、必须只动离屏 host、必须按计算样式而非行内正则。
   ════════════════════════════════════════════════════════════════════════════ */

const src = readFileSync(new URL('./render-raster.ts', import.meta.url), 'utf8');

test('导出截图前必须先摊平 cover(html2canvas 忽略 object-position 的绕行)', () => {
  assert.match(src, /async function flattenCoverImagesForCapture\(/);
  const flatten = src.indexOf('await flattenCoverImagesForCapture(host, scale)');
  const capture = src.indexOf('return await html2canvas(host');
  assert.ok(flatten > 0, '截图路径必须调用摊平 pass,且传截图倍率(预烘位图分辨率同源)');
  assert.ok(capture > flatten, '摊平必须发生在 html2canvas 之前');
});

test('摊平只动离屏 host,先等图片解码;非旋转路径按计算样式预烘位图', () => {
  const body = src.slice(
    src.indexOf('async function flattenCoverImagesForCapture('),
    src.indexOf('export interface FaceRenderOptions'),
  );
  assert.match(body, /host\.querySelectorAll/, '作用域限定在离屏 host');
  assert.match(body, /img\.decode\(\)/, '摊平要读 naturalWidth,先等解码');
  assert.match(
    body,
    /const computed = getComputedStyle\(img\)/,
    '一律读计算样式 —— 行内正则只认编辑器窄格式,AI 手写页(class/关键字/px/translate)会读歪',
  );
  assert.match(
    body,
    /computed\.objectPosition/,
    'object-position 必须取计算值(关键字已解析成百分比)',
  );
  assert.match(body, /parseMatrix2d\(computed\.transform\)/, 'transform 读矩阵,不猜语法');
  assert.match(body, /img\.src = dataUrl/, '非旋转路径以预烘位图换 src,布局不动');
  assert.match(
    body,
    /img\.style\.width = `\$\{boxW\}px`/,
    '换 src 前先钉死布局尺寸 —— auto 尺寸的裸 img 换 src 会跳大小',
  );
});

test('盒交换旋转图保留显式几何摊平:偏移折进 transform 链尾(2026-08-02 实测模型)', () => {
  const body = src.slice(
    src.indexOf('async function flattenCoverImagesForCapture('),
    src.indexOf('export interface FaceRenderOptions'),
  );
  assert.match(body, /rotate % 90 === 0/, '只有编辑器的 90 步进旋转走盒交换分支,装饰性倾斜不进');
  assert.match(body, /coverContentBox\(/, '几何来自与屏幕同源的纯函数,不自己另算一套');
  assert.match(body, /rotate\(\$\{rotate\}deg\) translate\(/, '旋转图的内容偏移在旋转坐标系里补');
  assert.match(body, /objectFit = 'fill'/, '旋转分支 cover 语义摊平后必须退场');
});
