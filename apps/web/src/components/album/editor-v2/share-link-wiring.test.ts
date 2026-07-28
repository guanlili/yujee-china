import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const port = readFileSync(join(here, 'EditorPort.tsx'), 'utf8');
const mobile = readFileSync(join(here, 'mobile/use-share-link.ts'), 'utf8');

// 分享链接弹窗的 data-action 按钮(closeShareLink/confirmShareLink/copyShareLink)只有在
// canvasScopes() 把 shareLinkModal 纳入扫描范围时才会被 $$scoped('[data-action]') 绑上 click。
// 漏了 shareLinkModal → 弹窗能开(topbar 的 shareLink 在 .topbar 域内)但里面的按钮全哑,
// 「关闭」点了没反应(实测 bug)。这里锁死:canvasScopes 必须列 shareLinkModal。
test('canvasScopes 必须包含 shareLinkModal(否则弹窗内按钮不接线)', () => {
  const scopes = port.match(/const canvasScopes = \(\)[\s\S]*?return out;/)?.[0] ?? '';
  assert.ok(scopes, 'canvasScopes should exist');
  assert.match(scopes, /add\(byId\('shareLinkModal'\)\)/, 'canvasScopes 必须扫描 shareLinkModal');
  // 参照物:能用的导出弹窗一直在域内。
  assert.match(scopes, /add\(byId\('exportMenuModal'\)\)/, 'exportMenuModal 仍应在域内');
});

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
