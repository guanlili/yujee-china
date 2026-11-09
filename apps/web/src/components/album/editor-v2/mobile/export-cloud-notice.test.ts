import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// 云端备份失败的语义(2026-11-09 生产实测):本地 PDF 生成成功、云端 PUT 每次
// ERR_ABORTED,而旧实现【完全静默】—— 只 console.error,用户与服务器都看不到。
// 后果是相册不会变 COMPLETED、pdfUrl 不落库,分享链接与换设备打开都拿不到成品,
// 用户却以为已经备份好了。
//
// 新语义:仍然是「本地拿到 = 导出成功,不弹导出失败框」,但**必须**在完成弹窗里
// 如实加一行云备份失败 —— 不误导,不拦路,不重复报错。
// 沿用仓库的源码断言风格(EditorPort 是大块命令式 DOM effect,无 jsdom harness)。

const here = dirname(fileURLToPath(import.meta.url));
function source(rel: string): string {
  return readFileSync(join(here, rel), 'utf8');
}

test('云端上传耗尽 → 设置云备份提示,而不是弹导出失败框', () => {
  const useExport = source('use-export.ts');
  const uploadSeg = useExport.slice(useExport.indexOf('void runExportWithRetry(() => uploadPdf('));
  assert.ok(uploadSeg.length > 0, 'upload 段必须可定位');
  assert.match(uploadSeg, /setCloudNotice\(/, 'upload 段耗尽必须留下云备份提示');
  assert.doesNotMatch(uploadSeg, /setFailed\(true\)/, '本地已成功,绝不弹导出失败框');
  assert.match(uploadSeg, /buildExportFailureLog/, 'upload 段耗尽仍要落结构化日志');
});

test('新一轮导出必须先清掉上一轮的云备份提示', () => {
  const useExport = source('use-export.ts');
  const head = useExport.slice(
    useExport.indexOf('const exportPdf = useCallback'),
    useExport.indexOf('let blob: Blob | null = null'),
  );
  assert.match(head, /setCloudNotice\(null\)/, '新导出不得继承上一轮的结论');
});

test('完成弹窗把提示渲染出来,且不挡保存按钮', () => {
  const modals = source('modals/ExportModals.tsx');
  assert.match(modals, /cloudNotice\?: string \| null/, 'ExportReadyModal 必须接收 cloudNotice');
  assert.match(modals, /data-testid="export-cloud-notice"/, '提示要有可核验的锚点');
  assert.match(modals, /export-ready-save/, '保存/分享按钮必须保留');
});

test('移动端根组件把云备份提示接到弹窗上', () => {
  const root = source('MobileEditorRoot.tsx');
  assert.match(root, /cloudNotice=\{exporter\.exportCloudNotice\}/, '提示必须在真实挂载处透传');
});

test('直传有明确截止时间 —— 否则挂住的请求会让重试永远停在第 1 次', () => {
  // 线上实测:PUT 一直 inflight(既不 200 也不报错),runExportWithRetry 卡在第 1 次,
  // 「3 次耗尽」永远不到,云备份提示因此永远不出现。超时是这条修复成立的前提。
  // 2026-11-09 起两端共用 export-retry-util 里同一份实现,不再各写一套。
  const util = source('../export-retry-util.ts');
  assert.match(util, /PDF_UPLOAD_TIMEOUT_MS\s*=\s*\d/, '必须定义上传截止时间');
  const net = source('../../../../lib/net/fetch-timeout.ts');
  assert.match(net, /setTimeout\(\(\) => ctrl\.abort\(\)/, '到点必须 abort');
  const useExport = source('use-export.ts');
  assert.match(
    useExport,
    /putRes\s*=\s*await fetchWithTimeout\(/,
    '移动端:超时必须包在真正上传那一次调用上,不能只包签名',
  );
  const book = source('../EditorBook.tsx');
  assert.match(
    book,
    /putRes = await fetchWithTimeout\(\s*putUrl/,
    '桌面端:同一条直传也必须有截止时间',
  );
});
