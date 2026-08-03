import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// 分享页 chrome(2026-08-03 用户拍板):FlipBook 唯一消费方是免登分享页(SharedAlbum),
// 它是纯阅读面 —— ①底部缩略图条退场;②不画选中描边框;③导航只剩书两侧各一枚小圆钮。
// 与 flipbook-solo/spread 同为源文本断言(大客户端组件无 jsdom 夹具)。

const here = dirname(fileURLToPath(import.meta.url));
const tsx = readFileSync(join(here, 'FlipBook.tsx'), 'utf8');
const shared = readFileSync(join(here, 'SharedAlbum.tsx'), 'utf8');

test('底部缩略图条已退场:不再渲染 per-spread 缩略格,也没有低清缩略解析器', () => {
  assert.doesNotMatch(tsx, /thumbnail strip/i, '缩略图条 JSX 不许回来');
  assert.doesNotMatch(tsx, /w-\[52px\]|w-\[26px\]/, '不许再有 52/26px 的缩略格');
  assert.doesNotMatch(tsx, /resolveThumbImage|thumbResolver/, '缩略解析器随条一并退场');
  assert.doesNotMatch(tsx, /pageIndicator/, '页码指示随条退场(Strings 不再带 pageIndicator)');
  assert.doesNotMatch(shared, /pageIndicator/, 'SharedAlbum 的 STRINGS 同步不带 pageIndicator');
});

test('分享页不画选中框:Half 上没有 active 描边,也没有 inset 框', () => {
  assert.doesNotMatch(tsx, /inset 0 0 0 2px/, '选中页的 inset 描边框不许回来');
  assert.doesNotMatch(tsx, /active:\s*boolean/, 'Half 不再接 active 视觉态');
});

test('翻页导航:桌面书两侧各一枚小圆钮,移动端沉到底部居中(同 md/767 断点)', () => {
  // 两枚按钮同一份 navBtns 数据 + 同一个 navBtn 渲染,只有摆位随断点变。
  assert.match(tsx, /\{ dir: -1 as const[\s\S]*?hidden: spread === 0 \}/, '左钮:封面处隐藏');
  assert.match(tsx, /\{ dir: 1 as const[\s\S]*?hidden: spread >= spreadCount - 1 \}/, '右钮:末跨页处隐藏');
  assert.match(tsx, /onClick=\{\(\) => step\(dir\)\}/, '按钮必须走 step(dir) 单跨页步进');
  assert.match(tsx, /disabled=\{hidden \|\| !!anim\}/, '翻页动画中禁点,防连翻错乱');
  // 桌面:两侧垂直居中,移动端整组隐藏(hidden … md:flex)。
  assert.match(tsx, /absolute top-1\/2 z-\[7\] hidden -translate-y-1\/2 md:flex \$\{b\.dir === -1 \? 'left-3' : 'right-3'\}/, '桌面钮:两侧垂直居中,移动端不渲染在两侧');
  // 移动端:底部居中一排,桌面隐藏(md:hidden)。
  assert.match(tsx, /bottom-5 left-1\/2 z-\[7\] flex -translate-x-1\/2 items-center gap-4 md:hidden/, '移动端钮:底部居中一排');
  // 书体适配随断点让位:桌面横向 104(两侧钮),移动端纵向 88(底部钮)。
  assert.match(tsx, /window\.innerWidth < 768/, '断点与 Tailwind md/产品 767 移动判定同一边界');
  assert.match(tsx, /clientHeight - \(mobile \? 88 : 32\)/, '移动端为底部按钮留高');
  assert.match(tsx, /clientWidth - \(mobile \? 16 : 104\)/, '桌面为两侧按钮留宽');
  assert.doesNotMatch(tsx, /clientHeight - 96/, '不再为底部条预留高度');
});
