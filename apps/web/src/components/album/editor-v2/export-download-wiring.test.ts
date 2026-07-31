import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

/* ════════════════════════════════════════════════════════════════════════════
   动态图片(Live / 九宫格)交付方式的守卫。

   真实事故:导出成功一次之后就再也下载不到文件 —— 进度条正常跑完、代码没抛错、
   浏览器下载目录里什么都没有。

   原因不在导出实现,在**交付**:那一版把「打包成一个 zip 下载」改成了连续下载两个
   文件(封面 + 视频)。桌面 Chrome 对「同一站点自动下载多个文件」有站点级权限,
   第一次放行第一个文件并弹提示,提示被拒绝/忽略后该站点进黑名单,之后所有自动下载
   被**静默丢弃**。于是表现为「第一次能下、后面永远不能」,且没有任何报错可查。

   所以浏览器兜底路径必须只发起**一次**下载。而且不该靠 zip 去凑 —— 让用户多解一次
   压缩包是把技术限制转嫁给用户。正确解法是**别给第二个文件**:封面已经被
   renderNineGridVideo 渲成了视频第一帧(COVER_FRAME_SECONDS),单独给一份是内容冗余。

   封面作为独立文件只为 iOS 那条分支存在:Live Photo 要 jpg + 视频成对进相册,
   分享面板本来就收多文件、也不受上面那条限制。桌面拼不了 Live Photo。
   两条路径的差异是有意的。
   ════════════════════════════════════════════════════════════════════════════ */

const here = dirname(fileURLToPath(import.meta.url));
const editorPort = readFileSync(join(here, 'EditorPort.tsx'), 'utf8');
const mobileExport = readFileSync(join(here, 'mobile/use-export.ts'), 'utf8');
// 交付规则住在共享层:桌面与移动端各自 import 它,两端不许再各写一份。
const delivery = readFileSync(join(here, '../../../lib/export/live-delivery.ts'), 'utf8');

/** 取 deliverLiveAssets 的函数体。 */
function deliverLiveAssetsBody(): string {
  const m = delivery.match(/export async function deliverLiveAssets\([\s\S]*?\n\}/);
  assert.ok(m, 'deliverLiveAssets should exist in lib/export/live-delivery');
  return m[0];
}

test('动态图片的下载兜底只发起一次下载,且交付的是视频本身', () => {
  const body = deliverLiveAssetsBody();
  assert.doesNotMatch(
    body,
    /downloadBlobs\(/,
    'downloadBlobs 会逐个发起下载 —— 正是导致「下过一次就再也下不到」的那条路径',
  );
  // 下载调用只能有一处,且下的是 video(不是 zip、不是封面)。
  const downloadCalls = body.match(/downloadBlob\(/g) ?? [];
  assert.equal(downloadCalls.length, 1, `兜底只能发起一次下载,现在有 ${downloadCalls.length} 处`);
  assert.match(body, /downloadBlob\(video,/, '交付的应当是视频本身');
  assert.doesNotMatch(
    body,
    /createZipBlob|\.zip/,
    '不要用 zip 绕开限制 —— 让用户多解一次压缩包是把技术限制转嫁给用户;封面本来就是视频第一帧,不必单独给',
  );
});

test('iOS 仍走 navigator.share 分享原始文件,不打包', () => {
  const body = deliverLiveAssetsBody();
  // Live Photo 要 jpg + 视频成对进相册,打成 zip 就没法用了;分享面板也本来就收多文件。
  assert.match(body, /navigator\.share\(shareData\)/, 'Apple 移动端仍应走分享面板');
  assert.match(
    body,
    /isAppleMobileDevice\(\)[\s\S]*?navigator\.share/,
    '分享面板这条要按设备判定,不能变成所有平台都走',
  );
});

test('Live 交付从保存按钮同步进入分享/下载,不先 await 丢掉移动端用户授权', () => {
  const body = deliverLiveAssetsBody();
  const shareAt = body.indexOf('navigator.share(');
  assert.ok(shareAt >= 0, '缺少系统分享调用');
  // 调用本身写成 `await navigator.share(...)` 没问题;要禁止的是它**之前**先等别的异步任务。
  const beforeShareCall = body.slice(0, shareAt).replace(/\bawait\s*$/, '');
  assert.doesNotMatch(
    beforeShareCall,
    /\bawait\b/,
    'navigator.share 前一旦 await,保存按钮带来的瞬时用户授权可能已经失效',
  );
});

test('两端都用共享的交付实现,不各写一份', () => {
  // 这条规则是踩出来的(见抬头),两端各写一份就会各踩一次。
  // 桌面端可按需加载;移动端必须静态加载,才能让保存按钮同步进入 navigator.share。
  const usesShared = /(from|import\()\s*'@\/lib\/export\/live-delivery'/;
  assert.match(editorPort, usesShared, '桌面必须用共享交付');
  assert.match(mobileExport, usesShared, '移动端必须用共享交付');
  for (const [name, src] of [['EditorPort', editorPort], ['use-export', mobileExport]] as const) {
    assert.doesNotMatch(
      src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''),
      /function deliverLiveAssets|function isAppleMobileDevice/,
      `${name} 不该再有本地的交付实现`,
    );
  }
});

test('封面确实被渲进了视频第一帧(上面「不必单独给封面」的前提)', () => {
  // 这条前提一旦不成立,桌面用户就真的拿不到封面了 —— 所以把它钉在这里,
  // 而不是只写在注释里。
  const motion = readFileSync(join(here, '../../../lib/export/nine-grid-motion.ts'), 'utf8');
  assert.match(motion, /COVER_FRAME_SECONDS/, '视频应当以一段封面帧开头');
  assert.match(
    motion,
    /if \(seconds < COVER_FRAME_SECONDS\) \{\s*renderCoverFrame\(/,
    '开头那段必须真的渲封面帧,而不只是留了个常量',
  );
});
