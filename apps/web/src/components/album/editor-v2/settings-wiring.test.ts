import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

/* 全局创作设置 OCC(Phase 2B)的接线守卫。title/画板背景/全书滤镜三处写入:
     · 桌面(EditorShell 滤镜保存器 + EditorBook 标题/背景)与移动端共用
       settings-save-transport,不许再手搓裸 PATCH(schema 的 baseSettingsRevision
       已必填,裸 PATCH 会 400)
     · 基线是共享 ref:同一客户端三处写入用同一基线,自己不跟自己 409
     · 成功读回推进;SETTINGS_CONFLICT 采纳服务器基线 + 回滚乐观 UI + 可见提示 */

const here = dirname(fileURLToPath(import.meta.url));
const read = (...p: string[]) => readFileSync(join(here, ...p), 'utf8');

const editor = read('EditorPort.tsx');
const mobileRoot = read('mobile', 'MobileEditorRoot.tsx');
const libRead = (...p: string[]) =>
  readFileSync(join(here, '..', '..', '..', 'lib', ...p), 'utf8');
const transport = libRead('collaboration', 'settings-save-transport.ts');
const schema = readFileSync(
  join(here, '..', '..', '..', 'app', 'api', 'v1', 'albums', '[uuid]', 'schema.ts'),
  'utf8',
);

test('传输层:409 SETTINGS_CONFLICT 映射 conflict 并带服务器基线;forbidden/network 分明', () => {
  assert.match(transport, /SETTINGS_CONFLICT/);
  assert.match(transport, /currentSettingsRevision/);
  assert.match(transport, /baseSettingsRevision: opts\.baseSettingsRevision/);
  assert.match(transport, /kind: 'forbidden'/);
  assert.match(transport, /kind: 'network'/);
});

// 主站的口径与参考实现有一处**有意分歧**:baseSettingsRevision 在 schema 里是
// 可选(发布阶段 A 过渡态)。参考仓设成必填是因为它的前端同时改完了;主站前端
// 尚未全部带上,必填会让 owner 自己改书名/背景/滤镜全部 400。
//
// 但「可选」不等于「可以盲写」—— 协同并发的安全性移到了 service 层那条
// 「editor 省略基线一律拒绝」。这条守卫因此改钉两件事:schema 形状仍在(给了就
// 必须合法),且 service 层的 editor 闸没有被删。阶段 C 前端全部带上后,把
// optional 去掉、并把本用例换回 doesNotMatch(optional)。
test('后端契约:baseSettingsRevision 形状仍在;editor 盲写由 service 层拦死', () => {
  assert.match(schema, /baseSettingsRevision: z\.number\(\)\.int\(\)\.min\(0\)/);
  const service = readFileSync(
    join(here, '..', '..', '..', 'services', 'album', 'album-service.ts'),
    'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.match(
    service,
    /baseSettingsRevision === undefined[\s\S]{0,200}role === 'editor'[\s\S]{0,200}VALIDATION_FAILED/,
    'lockAlbumForSettingsWrite 必须保留「editor 省略基线即拒」—— 它是可选 schema 下唯一的协同并发防线',
  );
  assert.match(
    service,
    /baseVersion === undefined && role === 'editor'/,
    'updatePage 的同款 editor 闸也必须在',
  );
});

test('两端都走共享传输层,不再有裸 PATCH /albums/:id', () => {
  for (const [name, src] of [
    ['EditorPort', editor],
    ['MobileEditorRoot', mobileRoot],
  ] as const) {
    assert.match(src, /settings-save-transport/, `${name} 引用共享设置传输层`);
    assert.doesNotMatch(
      src,
      /fetch\(`\/api\/v1\/albums\/\$\{[^}]+\}`, \{\s*method: 'PATCH'/,
      `${name} 不得残留裸设置 PATCH`,
    );
  }
});

test('桌面:滤镜/标题/背景提交精确基线,成功读回推进共享 ref', () => {
  assert.match(editor, /const settingsRevisionRef = useRef\(detail\.album\.settingsRevision \?\? 0\)/);
  // 三处写入同一 ref:filterSaver(EditorShell)+ title/boardBackground(EditorBook)。
  const reads = editor.match(/baseSettingsRevision: settingsRevisionRef\.current/g) ?? [];
  assert.ok(reads.length >= 3, `桌面应有 ≥3 处基线提交,实际 ${reads.length}`);
  const writes = editor.match(/settingsRevisionRef\.current = out\.settingsRevision/g) ?? [];
  assert.equal(writes.length, 3, '三处写入都要读回推进');
  // authoring 的 draft skeleton 比 detail 新,同步 effect 兜住两条来源。
  assert.match(editor, /draftChapters\?\.settingsRevision \?\? detail\.album\.settingsRevision/);
});

test('移动端:滤镜/背景提交精确基线,成功读回推进共享 ref', () => {
  assert.match(mobileRoot, /const settingsRevisionRef = useRef\(detail\.album\.settingsRevision \?\? 0\)/);
  const reads = mobileRoot.match(/baseSettingsRevision: settingsRevisionRef\.current/g) ?? [];
  assert.equal(reads.length, 2, '移动端两处写入(滤镜 + 画板背景)');
  const writes = mobileRoot.match(/settingsRevisionRef\.current = out\.settingsRevision/g) ?? [];
  assert.equal(writes.length, 2);
  assert.match(mobileRoot, /draftChapters\?\.settingsRevision \?\? detail\.album\.settingsRevision/);
});

test('冲突处置:两端都采纳服务器基线 + 回滚乐观 UI + 可见提示', () => {
  for (const [name, src, rollbacks] of [
    ['EditorPort', editor, ['boardBg = prev', 'titleEl\\.textContent = prevTitle']],
    ['MobileEditorRoot', mobileRoot, ['setBoardBgOverride\\(prev\\)']],
  ] as const) {
    assert.match(src, /kind === 'conflict'/, `${name} 处理设置冲突`);
    assert.match(src, /currentSettingsRevision/, `${name} 冲突时采纳服务器基线`);
    for (const rollback of rollbacks) {
      assert.match(src, new RegExp(rollback), `${name} 冲突回滚:${rollback}`);
    }
  }
});

test('Creator 口径:设置入口不再对 editor 隐藏(治理入口仍 owner-only)', () => {
  // 桌面标题:两端都可编辑,不再按 isOwner 关 contentEditable。
  assert.doesNotMatch(editor, /contentEditable=\{isOwner\}/);
  // 移动端全书滤镜:不再 isOwner 三元隐藏;协作/备份保持治理或 Phase 3 口径。
  assert.doesNotMatch(mobileRoot, /onPhotoFilter=\{isOwner \?/);
  assert.match(mobileRoot, /onPhotoFilter=\{openBookFilter\}/);
});
