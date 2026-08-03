import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// 导出语义【解耦】(用户诉求):本地拿到 PDF = 导出成功;云端上传(R2 + 落库)失败要
// 【完全静默】—— 后台自动重试、只落日志,绝不弹「导出失败」安抚框。本地没配 R2 时
// upload 必然失败,旧逻辑会把它误报成「导出失败」,正是这条测试要钉死的回归。
// EditorPort 是大块命令式 DOM effect、无 jsdom harness,沿用仓库的源码断言风格
// (同 editor-flow-fixes / thinking-await-exclusive)。

const here = dirname(fileURLToPath(import.meta.url));
function source(file: string): string {
  return readFileSync(join(here, file), 'utf8');
}
function exportPdfBody(src: string): string {
  // 签名可带参数(2026-08-03 出血设计:bleedMm = 0);断言语义不变。
  const m = /async function exportPdf\([^)]*\)\s*\{[\s\S]*?\n {4}\}/.exec(src);
  assert.ok(m, 'exportPdf() body must be parseable');
  return m![0];
}

test('render 段连续失败才弹「导出失败」安抚框(真·导出失败:用户没拿到文件)', () => {
  const body = exportPdfBody(source('EditorPort.tsx'));
  const renderSeg = body.slice(0, body.indexOf('uploadPdfOnce'));
  assert.match(renderSeg, /openExportFailModal\(\)/, 'render 段耗尽必须弹安抚框');
  assert.match(renderSeg, /buildExportFailureLog/, 'render 段耗尽必须落日志');
});

test('render 成功、拿到 blob 后才进入云端上传', () => {
  const body = exportPdfBody(source('EditorPort.tsx'));
  const guard = /if \(!rendered\.ok \|\| blob == null\) return;/;
  assert.match(body, guard, 'upload 前必须有 render 成功守卫');
  assert.ok(
    body.search(guard) < body.indexOf('uploadPdfOnce'),
    '守卫必须在 uploadPdfOnce 调用之前',
  );
});

test('云端上传失败【完全静默】:只落日志,绝不弹安抚框、不向用户提示', () => {
  const body = exportPdfBody(source('EditorPort.tsx'));
  // upload 重试域 = 从 uploadPdfOnce 调用点到 exportPdf 末尾。
  const uploadSeg = body.slice(body.indexOf('uploadPdfOnce'));
  assert.match(uploadSeg, /buildExportFailureLog/, 'upload 段耗尽要落日志(可观测)');
  assert.doesNotMatch(
    uploadSeg,
    /openExportFailModal\(\)/,
    'upload 段绝不能弹「导出失败」框(用户已拿到 PDF,云端上传失败须静默)',
  );
  assert.doesNotMatch(
    uploadSeg,
    /appendAiText|appendReplyBody|alert\(/,
    'upload 段绝不向用户提示',
  );
});
