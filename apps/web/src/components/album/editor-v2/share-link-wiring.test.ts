import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const port = readFileSync(join(here, 'EditorPort.tsx'), 'utf8') + '\n\n' + readFileSync(join(here, 'EditorBook.tsx'), 'utf8');
const mobile = readFileSync(join(here, 'mobile/use-share-link.ts'), 'utf8');

// 分享链接弹窗的按钮(closeShareLink/confirmShareLink/copyShareLink)曾因为漏进
// canvasScopes 白名单而全哑,「关闭」点了没反应(实测 bug)。那份白名单已经删除,
// 扫描改成「整棵 root 扫、只排对话栏子树」,新弹窗不再需要登记 —— 这条保证现在是
// modal-action-wiring.test.ts 统一守(源码形状断言,已用 mutation testing 逐条验证),
// 不再逐个弹窗写断言。

// 弹窗内四条出口路径都要通:生成(confirmShareLink)、复制(copyShareLink)、
// 关闭(closeShareLink)三条走 data-action dispatch,背景点关(data-overlay-close)走
// 硬编码 overlay 列表。缺一即「点了没反应」。
test('分享链接三 action 都在 dispatch map 且 closeShareLink 摘 .open', () => {
  assert.match(port, /shareLink,/, 'shareLink handler 已注册');
  assert.match(port, /confirmShareLink: \(\) => void confirmShareLink\(\)/, 'confirmShareLink handler 已注册');
  assert.match(port, /copyShareLink,/, 'copyShareLink handler 已注册');
  assert.match(
    port,
    /closeShareLink: \(\) => byId\('shareLinkModal'\)\?\.classList\.remove\('open'\)/,
    'closeShareLink 关闭弹窗',
  );
});

test('背景点关(overlay-close)硬编码列表包含 shareLinkModal', () => {
  assert.match(port, /\['shareLinkModal', \(\) => byId\('shareLinkModal'\)\?\.classList\.remove\('open'\)\]/, '背景点关列表须含 shareLinkModal');
});

test('shareLinkModal DOM 内确有生成/复制/关闭三个 data-action 按钮', () => {
  const modal = port.match(/id="shareLinkModal"[\s\S]*?拼图二级弹窗/)?.[0] ?? '';
  assert.ok(modal, 'shareLinkModal DOM 块应存在');
  assert.match(modal, /data-action="confirmShareLink"/, '生成按钮在弹窗内');
  assert.match(modal, /data-action="copyShareLink"/, '复制按钮在弹窗内');
  assert.match(modal, /data-action="closeShareLink"/, '关闭按钮在弹窗内');
});

test('desktop and mobile both route server snapshot-version errors through the shared mapper', () => {
  for (const [name, source] of [['desktop', port], ['mobile', mobile]] as const) {
    assert.match(
      source,
      /photoSnapshotVersionMissingHint\(\s*json\?\.error,/,
      `${name} share flow must map the stable server error`,
    );
  }
});
