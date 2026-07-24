import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { PAGE } from '@yujee/contracts/render/constants';
import { faceCaptureSpec } from './face-capture';

// #303 C1 回归。renderFaceToCanvas 曾把离屏 host 的 cssText 和 html2canvas 的
// width/height 都写死成 PAGE.width/PAGE.height,于是一个双宽(1588px)页只截到左边
// 794px —— 右半连同右下角页码被裁掉。然后 PDF 又拿这张「已经是 A4」的图去
// splitSpreadCanvas 切两半,得到两条半幅细条,再各自拉伸成整页 A4。
// 截图尺寸的决策抽在这里(纯函数),因为 render-raster.ts 拉着 react-dom/server +
// DOM,无法在没有 DOM 的 test runner 里 import —— 与 splitBox 同一处理方式。

test('a normal page captures at exactly one A4 box (pixel-identical to before #303)', () => {
  const spec = faceCaptureSpec('mag-03');
  assert.equal(spec.width, PAGE.width);
  assert.equal(spec.height, PAGE.height);
  assert.match(spec.cssText, new RegExp(`width:${PAGE.width}px;height:${PAGE.height}px`));
});

test('a spread template captures at the FULL double-wide box, not the left half', () => {
  const spec = faceCaptureSpec('mag-54');
  assert.equal(spec.width, PAGE.width * 2, '双宽页必须按 1588 开盒,否则右半被裁掉');
  assert.equal(spec.height, PAGE.height);
  // host 的盒子与 html2canvas 的视口必须同源同尺寸 —— 只改一个,另一个会裁/留白。
  assert.match(spec.cssText, new RegExp(`width:${PAGE.width * 2}px;height:${PAGE.height}px`));
});

test('the host stays off-screen, clipped and white-backed for every template', () => {
  for (const id of ['mag-03', 'mag-54']) {
    const { cssText } = faceCaptureSpec(id);
    assert.match(cssText, /position:fixed/);
    assert.match(cssText, /left:-99999px/);
    assert.match(cssText, /overflow:hidden/);
    assert.match(cssText, /background:#fff/);
  }
});

// 光有纯函数还不够:得 pin 住 renderFaceToCanvas 真的用了它(两处都用),
// 否则纯函数可以完美通过测试而调用方继续写死 PAGE.width。
test('renderFaceToCanvas sizes BOTH the host and the html2canvas viewport from faceCaptureSpec', () => {
  const src = readFileSync(new URL('./render-raster.ts', import.meta.url), 'utf8');
  assert.match(src, /const capture = faceCaptureSpec\(page\.templateId\)/);
  assert.match(src, /host\.style\.cssText = capture\.cssText/);
  assert.match(
    src,
    /html2canvas\(host,\s*\{\s*\n\s*width: capture\.width,\s*\n\s*height: capture\.height,/,
    'html2canvas 的视口也必须来自 faceCaptureSpec —— 只改 host 会留白/裁切',
  );
  // 反向守卫:截图路径里不能再出现写死的 PAGE.width/PAGE.height 开盒。
  const fn = /export async function renderFaceToCanvas\([^]*?\n\}/.exec(src);
  assert.ok(fn, 'expected to locate renderFaceToCanvas');
  assert.doesNotMatch(
    fn![0],
    /PAGE\.(width|height)/,
    'renderFaceToCanvas 不得再直接读 PAGE —— 尺寸唯一真相是 faceCaptureSpec/pageBox',
  );
});
