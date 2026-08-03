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

test('翻页导航是书两侧各一枚小圆钮:垂直居中、到头淡出、动画中禁点', () => {
  // 两枚按钮走同一份 map(方向/贴边/箭头三元组),都调 step()。
  assert.match(tsx, /\{ dir: -1 as const[\s\S]*?edge: 'left-3'[\s\S]*?hidden: spread === 0 \}/, '左钮:贴左、封面处隐藏');
  assert.match(tsx, /\{ dir: 1 as const[\s\S]*?edge: 'right-3'[\s\S]*?hidden: spread >= spreadCount - 1 \}/, '右钮:贴右、末跨页处隐藏');
  assert.match(tsx, /onClick=\{\(\) => step\(dir\)\}/, '按钮必须走 step(dir) 单跨页步进');
  assert.match(tsx, /top-1\/2 z-\[7\] flex h-9 w-9 -translate-y-1\/2/, '小圆钮:9×9、垂直居中、浮在书之上');
  assert.match(tsx, /disabled=\{hidden \|\| !!anim\}/, '翻页动画中禁点,防连翻错乱');
  // 书体适配为两侧按钮让位(不再为底部条留 96px 高)。
  assert.match(tsx, /clientWidth - 104/, '横向为两侧按钮各留位');
  assert.doesNotMatch(tsx, /clientHeight - 96/, '不再为底部条预留高度');
});
