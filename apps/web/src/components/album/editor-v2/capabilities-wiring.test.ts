import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

/* capabilities 收口(Phase 5)的接线守卫:
     · 共享纯模块是产品授权唯一真相,服务端 re-export 同源 —— 两端口径不许漂移
     · 组件不再手写 isOwner 产品判断,治理入口显隐走 capabilitiesForRole
     · 治理入口(协作)owner-only;创作入口(标题/滤镜/分享/导出/备份)无角色条件 */

const here = dirname(fileURLToPath(import.meta.url));
const read = (...p: string[]) => readFileSync(join(here, ...p), 'utf8');

const editor = read('EditorPort.tsx') + '\n\n' + read('EditorBook.tsx')
const editorBook = read('EditorBook.tsx');
const mobileRoot = read('mobile', 'MobileEditorRoot.tsx');
const shared = readFileSync(
  join(here, '..', '..', '..', 'lib', 'collaboration', 'capabilities.ts'),
  'utf8',
);
const service = readFileSync(
  join(here, '..', '..', '..', 'services', 'collaboration', 'collaboration-service.ts'),
  'utf8',
);

test('共享纯模块:Creator 七项 + 治理三项,editor 不含治理能力', () => {
  for (const cap of ['editContent', 'editStructure', 'editSettings', 'uploadPhotos', 'runAI', 'export', 'createShare']) {
    assert.ok(shared.includes(`'${cap}'`), `Creator 能力 ${cap} 在共享清单`);
  }
  for (const cap of ['manageMembers', 'deleteAlbum', 'transferOwnership']) {
    assert.match(shared, new RegExp(`'${cap}'`), `治理能力 ${cap} 在 owner-only 清单`);
  }
  // 零副作用:不许 import db/repos(前端也要加载这份定义)。
  assert.doesNotMatch(shared, /from '@\/db|from '\.\.\/\.\.\/db/);
});

test('服务端从共享模块 re-export,不再自带第二份定义', () => {
  assert.match(service, /from '@\/lib\/collaboration\/capabilities'/);
  assert.doesNotMatch(service, /export function albumCapabilities/);
});

test('两端治理入口判据走 capabilitiesForRole,不再手写 isOwner', () => {
  for (const [name, src] of [
    ['EditorPort', editor],
    ['MobileEditorRoot', mobileRoot],
  ] as const) {
    assert.match(src, /capabilitiesForRole\(detail\.album\.role\)\.has\('manageMembers'\)/, `${name} 治理判据来自共享 capabilities`);
    assert.doesNotMatch(src, /const isOwner = detail\.album\.role/, `${name} 不再手写 isOwner 产品判断`);
    assert.match(src, /from '@\/lib\/collaboration\/capabilities'/);
  }
});

test('创作入口不再按角色隐藏(桌面协作按钮是唯一的 isOwner 条件位)', () => {
  // 标题两端可编辑、滤镜/备份/分享/导出无条件渲染 —— 源码里不得再出现创作入口的角色三元。
  assert.doesNotMatch(editor, /contentEditable=\{isOwner\}/);
  assert.doesNotMatch(mobileRoot, /onPhotoFilter=\{isOwner \?/);
  assert.doesNotMatch(mobileRoot, /onBackupPhotos=\{isOwner \?/);
});

test('冲突 UI 四维度各有明确行动(源码接线守卫)', () => {
  // page(此页已被他人修改)/structure(结构已变化)/settings(已恢复+可操作提示)
  // /AI stale(基于最新版本重跑)—— 四类冲突文案两端至少一处接线。
  const chat = read('ChatPanel.tsx');
  assert.match(editor, /此页已被他人修改/);
  assert.match(mobileRoot, /此页已被他人修改/);
  assert.match(editor, /页面结构已变化/);
  assert.match(mobileRoot, /结构已变化/);
  assert.match(editor, /标题已被他人修改/);
  assert.match(editor, /背景已被他人修改/);
  assert.match(mobileRoot, /背景已被他人修改/);
  assert.match(chat, /lastComposeStale/);
  assert.match(chat, /没有写进书里/);
});
