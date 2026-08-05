import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

// 游客模式前端闸门的源码断言(防回退):
// ① 落地页发送不再跳登录,而是静默建匿名影子账号;
// ② 编辑器保存/分享对游客弹登录;PDF 导出对游客跳过云上传(桌面 + 移动);
// ③ 自动上云(原图对账补传)只对真实账号开;
// ④ 占位书(copySource='placeholder')登录后自动补跑真 compose;
// ⑤ 游客顶栏是「登录」CTA,不渲染账号菜单。

const HERE = import.meta.dirname;
const read = (rel: string) => readFileSync(join(HERE, rel), 'utf8');

test('① HeroComposer:无 session 时 signIn.anonymous 静默建号,不再直接跳登录', () => {
  const src = read('../../landing/HeroComposer.tsx');
  assert.match(src, /signIn\.anonymous\(\)/);
  assert.match(src, /AnonLimitError/, '游客撞上限要走存草稿跳登录的处置');
  assert.match(src, /skipCloudBackup: opts\.anonymous === true/, '游客创建后不得上传照片快照');
});

test('② EditorPort:保存/分享挂 guestGate,PDF 云上传对游客短路', () => {
  const src = read('./EditorPort.tsx');
  assert.match(src, /function guestGate\(\)/);
  assert.match(src, /async function backupPhotos\(\) \{\n      if \(guestGate\(\)\) return;/);
  assert.match(src, /function shareLink\(\) \{\n      if \(guestGate\(\)\) return;/);
  assert.match(src, /if \(viewerAnonRef\.current === true\) return;\n\s+await runExportWithRetry\(\(\) => uploadPdfOnce/);
});

test('②③ 移动端:use-export 支持 skipCloudUpload,MobileEditorRoot 游客态接线齐全', () => {
  const exportSrc = read('./mobile/use-export.ts');
  assert.match(exportSrc, /skipCloudUpload/);
  assert.match(exportSrc, /if \(!skipCloudUpload\) \{/);

  const rootSrc = read('./mobile/MobileEditorRoot.tsx');
  assert.match(rootSrc, /skipCloudUpload: isGuest/);
  assert.match(rootSrc, /enabled: Boolean\(viewerSession\.user && !viewerSession\.user\.isAnonymous\)/);
  assert.match(rootSrc, /if \(isGuest\) \{ goLogin\(\); return; \}/, '移动端保存必须先过游客门禁');
});

test('③ 桌面 EditorPort:原图对账补传只对真实账号开', () => {
  const src = read('./EditorPort.tsx');
  assert.match(src, /enabled: Boolean\(viewerSession\.user && !viewerSession\.user\.isAnonymous\)/);
  assert.doesNotMatch(src, /usePhotoOriginalSync\(\{[^}]*enabled: true/s);
});

test('④ ChatPanel:占位书登录后自动补跑真 compose + 游客打字门禁(迷你横幅,不跳转)', () => {
  const src = read('./ChatPanel.tsx');
  assert.match(src, /maybeUpgradePlaceholder/);
  assert.match(src, /copySource !== 'placeholder'/);
  assert.match(src, /viewerAnonRef\.current === true/, '对话改书前必须有游客门禁');
  assert.match(src, /ANON_UPGRADE_REQUIRED/, 'design-chat 的 403 兜底映射不能丢');
  // 游客打字 = 亮横幅,绝不 window.location 跳转 —— 硬跳转会把讲故事讲一半的游客
  // 甩出编辑器、输入丢失(上线首日实测教训,用户拍板改小提示)。
  assert.match(src, /setSending\(false\);\n\s+showGuestNudge\(\);/, '打字门禁必须走 showGuestNudge');
  assert.match(src, /id="guestAlert"/, '迷你登录横幅 #guestAlert 必须存在');
  assert.match(src, /showGuestNudge\(\{ auto: true \}\)/, '占位成书后要自动亮横幅');
  assert.doesNotMatch(
    src,
    /viewerAnonRef\.current === true\) \{\n\s+setSending\(false\);\n\s+window\.location/,
    '打字门禁不许回退成硬跳转',
  );
});

test('⑤ UserMenu:游客渲染登录 CTA,不渲染账号菜单', () => {
  const src = readFileSync(join(HERE, '../../app/UserMenu.tsx'), 'utf8');
  assert.match(src, /user\?\.isAnonymous/);
  assert.match(src, /\{c\.signIn\}/);
});
