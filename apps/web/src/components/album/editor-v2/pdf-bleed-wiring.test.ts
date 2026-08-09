import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

/* PDF 出血导出(2026-08-03 出血设计)+ 版式选择弹窗(2026-08-06 设计:
   docs/specs/2026-08-06-pdf-style-picker-design.md)的接线守卫。
   纯函数对错在 lib/pdf/extend-canvas-edges.test.ts;这里 pin 接线:
     · 渲染管线消费 bleedMm(pdfPageFormat + extendCanvasEdges),缺省 0 走原路径
     · 双端导出菜单只留一个 PDF 入口,印刷版收进「选版式」弹窗,默认选中标准版
     · 印刷卡片文案标注 3mm(「默认 3mm」的告知点)+ 含出血尺寸 216×303mm
     · 出血值 3 只在确认分派层出现,渲染层不硬编码
     · 出血版只本地下载,不上传云端(云端 PDF 保持标准版)
     · 桌面 export-gate 罩住菜单里的 PDF 入口(openPdfStyle) */

const here = dirname(fileURLToPath(import.meta.url));
const read = (...p: string[]) => readFileSync(join(here, ...p), 'utf8');

const editor = read('EditorPort.tsx');
const exportModals = read('mobile', 'modals', 'ExportModals.tsx');
const useExport = read('mobile', 'use-export.ts');
const mobileRoot = read('mobile', 'MobileEditorRoot.tsx');
const raster = read('..', '..', '..', 'lib', 'pdf', 'render-raster.ts');

test('渲染管线消费 bleedMm(pdfPageFormat + extendCanvasEdges),缺省 0 走原路径', () => {
  assert.match(raster, /bleedMm\?: number/);
  assert.match(raster, /pdfPageFormat\(bleedMm\)/);
  assert.match(raster, /extendCanvasEdges\(/);
  assert.match(raster, /options\.bleedMm \?\? 0/);
  assert.doesNotMatch(raster, /bleedMm: 3|bleedMm = 3/, '渲染层不硬编码出血值');
});

test('双端导出菜单只留一个 PDF 入口,印刷版直达按钮退场', () => {
  for (const [name, src] of [
    ['desktop', editor],
    ['mobile', exportModals],
  ] as const) {
    const pdfEntries = src.match(/data-testid="export-opt-pdf"/g) ?? [];
    assert.equal(pdfEntries.length, 1, `${name} 菜单恰好一个 PDF 入口`);
    assert.doesNotMatch(src, /export-opt-pdf-bleed/, `${name} 不再有印刷版直达按钮`);
  }
  // 桌面菜单按钮开弹窗,不直接导出
  assert.match(editor, /data-action="openPdfStyle" data-testid="export-opt-pdf"/);
  // 移动菜单组件不再有印刷版 handler(必填 handler 少一个 = 编译期挡死按钮)
  assert.doesNotMatch(exportModals, /onPdfBleed/);
});

test('双端各一个版式弹窗:标准/印刷两张卡,默认选中标准版', () => {
  for (const [name, src] of [
    ['desktop', editor],
    ['mobile', exportModals],
  ] as const) {
    assert.match(src, /3mm 出血|3mm bleed/, `${name} 印刷卡文案带 3mm`);
    assert.match(src, /216×303mm/, `${name} 说明带含出血尺寸`);
  }
  // 桌面:两张卡是字面 testid,打开时复位为标准版(selected + aria-pressed 对齐)
  assert.equal((editor.match(/data-testid="pdf-style-standard"/g) ?? []).length, 1, 'desktop 恰好一张标准版卡片');
  assert.equal((editor.match(/data-testid="pdf-style-bleed"/g) ?? []).length, 1, 'desktop 恰好一张印刷版卡片');
  assert.match(editor, /pdfStyle = 'standard';/, '桌面每次打开复位标准版');
  assert.match(editor, /getAttribute\('data-pdf-style'\) === 'standard'/);
  // 移动:卡片由 options 数组生成(testid 模板化),恰好 standard/bleed 两项
  assert.match(exportModals, /data-testid=\{`pdf-style-\$\{o\.id\}`\}/, 'mobile 卡片带模板 testid');
  assert.match(exportModals, /id: 'standard' \| 'bleed'/, 'mobile 版式恰好两种');
  // 移动:Root 打开前复位标准版
  assert.match(mobileRoot, /setPdfStyle\('standard'\)/, '移动每次打开复位标准版');
});

test('出血值 3 只在确认分派层:桌面 confirmPdfStyle + 移动 Root 各一处', () => {
  assert.match(
    editor,
    /confirmPdfStyle:[\s\S]{0,120}exportPdf\(pdfStyle === 'bleed' \? 3 : 0\)/,
    '桌面确认时按选中版式分派',
  );
  assert.match(mobileRoot, /exportPdf\(\{ bleedMm: 3 \}\)/, '移动确认时印刷版传 3');
  assert.match(useExport, /bleedMm: opts\?\.bleedMm \?\? 0/, 'use-export 只透传,不硬编码');
});

test('出血版只本地下载,不上传云端;文件名带 -bleed3mm 后缀', () => {
  assert.match(
    useExport,
    /if \(!skipCloudUpload && !opts\?\.bleedMm\) \{/,
    '移动端游客/出血版都跳过 uploadPdf(与 main 游客模式合流)',
  );
  assert.match(useExport, /-bleed3mm\.pdf/);
  assert.match(editor, /if \(bleedMm === 0\) \{/, '桌面出血版跳过 uploadPdfOnce');
  assert.match(editor, /exportBleedMm \? '-bleed3mm' : ''/);
});

test('桌面 export-gate 罩住菜单里的 PDF 入口', () => {
  assert.match(editor, /\['\[data-action="openPdfStyle"\]'\]/, '闸门选择器盯 openPdfStyle');
  assert.doesNotMatch(editor, /exportPdfBleed/, '旧的印刷版直达 action 退场');
});
