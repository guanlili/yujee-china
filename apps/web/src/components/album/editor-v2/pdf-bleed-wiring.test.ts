import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

/* PDF 出血导出(2026-08-03 设计:docs/specs/2026-08-03-pdf-bleed-export-design.md)
   的接线守卫。纯函数对错在 lib/pdf/extend-canvas-edges.test.ts;这里 pin 接线:
     · 渲染管线消费 bleedMm(pdfPageFormat + extendCanvasEdges),缺省 0 走原路径
     · 双端各恰好一个印刷版入口,文案标注 3mm(「默认 3mm」的告知点)
     · 出血值 3 只在入口层出现,渲染层不硬编码
     · 出血版只本地下载,不上传云端(云端 PDF 保持标准版)
     · 桌面 export-gate 同一把闸罩住印刷版入口 */

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

test('双端各恰好一个印刷版入口,文案标注 3mm', () => {
  for (const [name, src] of [
    ['desktop', editor],
    ['mobile', exportModals],
  ] as const) {
    const entries = src.match(/data-testid="export-opt-pdf-bleed"/g) ?? [];
    assert.equal(entries.length, 1, `${name} 恰好一个印刷版入口`);
    assert.match(src, /3mm 出血|3mm bleed/, `${name} 文案带 3mm`);
    assert.match(src, /216×303mm/, `${name} 说明带含出血尺寸`);
  }
});

test('出血值 3 只在入口层:桌面 dispatch + 移动 Root 各一处', () => {
  assert.match(editor, /exportPdfBleed: \(\) => void exportPdf\(3\)/, '桌面入口传 3');
  assert.match(mobileRoot, /exportPdf\(\{ bleedMm: 3 \}\)/, '移动入口传 3');
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

test('桌面 export-gate 同一把闸罩住印刷版入口', () => {
  assert.match(editor, /\[data-action="exportPdfBleed"\]/);
  assert.match(editor, /'\[data-action="exportPdf"\]', '\[data-action="exportPdfBleed"\]'/);
});
