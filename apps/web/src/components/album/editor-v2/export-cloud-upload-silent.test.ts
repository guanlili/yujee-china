import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// 导出语义【解耦】(用户诉求):本地拿到 PDF = 导出成功;云端上传(R2 + 落库)失败
// 不弹「导出失败」安抚框(那是 render 失败才该弹的),但要【让用户知道】——2026-11-09
// 起改为:后台自动重试(每次 60s 截止,所以一定会耗尽),耗尽后在输入框上方亮一条
// 非阻断横幅(buy-banner 同款容器),不进消息流、不锁输入,文案与移动端完成弹窗一致。
// 这条测试钉死两件事:别误报成「导出失败」, disturb 最小 (不 appendAiText / 不 alert)。

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
  const body = exportPdfBody(source('EditorPort.tsx') + '\n\n' + source('EditorBook.tsx'));
  const renderSeg = body.slice(0, body.indexOf('uploadPdfOnce'));
  assert.match(renderSeg, /openExportFailModal\(\)/, 'render 段耗尽必须弹安抚框');
  assert.match(renderSeg, /buildExportFailureLog/, 'render 段耗尽必须落日志');
});

test('render 成功、拿到 blob 后才进入云端上传', () => {
  const body = exportPdfBody(source('EditorPort.tsx') + '\n\n' + source('EditorBook.tsx'));
  const guard = /if \(!rendered\.ok \|\| blob == null\) return;/;
  assert.match(body, guard, 'upload 前必须有 render 成功守卫');
  assert.ok(
    body.search(guard) < body.indexOf('uploadPdfOnce'),
    '守卫必须在 uploadPdfOnce 调用之前',
  );
});

test('云端上传失败:不弹安抚框、不进消息流,但必须亮非阻断横幅告知', () => {
  const body = exportPdfBody(source('EditorPort.tsx') + '\n\n' + source('EditorBook.tsx'));
  // upload 重试域 = 从 uploadPdfOnce 调用点到 exportPdf 末尾。
  const uploadSeg = body.slice(body.indexOf('uploadPdfOnce'));
  assert.match(uploadSeg, /buildExportFailureLog/, 'upload 段耗尽要落日志(可观测)');
  assert.match(
    uploadSeg,
    /byId\('pdfCloudAlert'\)/,
    'upload 段耗尽必须在横幅里告知用户(移动端完成弹窗里是同一句话)',
  );
  // 直传必须带截止时间:挂住的 PUT 会让「3 次耗尽」永远不到,提示也就永不触发。
  // (uploadPdfOnce 定义在 exportPdf 之外,所以按整份源码断言)
  assert.match(source('EditorBook.tsx'), /putRes = await fetchWithTimeout\(\s*putUrl/, '直传必须走带截止时间的 fetch');
  assert.doesNotMatch(
    uploadSeg,
    /openExportFailModal\(\)/,
    'upload 段绝不能弹「导出失败」框(用户已拿到 PDF)',
  );
  assert.doesNotMatch(
    uploadSeg,
    /appendAiText|appendReplyBody|alert\(/,
    'upload 段不能进消息流、不能 alert(横幅是非阻断提示)',
  );
});
