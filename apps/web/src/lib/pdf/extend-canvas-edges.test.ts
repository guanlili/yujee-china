import assert from 'node:assert/strict';
import test from 'node:test';
import { CSS_PX_PER_MM, bleedCssPx, extendCanvasEdges, pdfPageFormat } from './extend-canvas-edges';

/* PDF 出血(2026-08-03 设计:docs/specs/2026-08-03-pdf-bleed-export-design.md):
   换算基准 794px ↔ 210mm;边缘延伸零位移零缩放。node 无真 canvas,几何用假画布
   记录 drawImage 调用断言;真像素由导出取证脚本覆盖(plan Task 4)。 */

test('换算:CSS_PX_PER_MM 与 3mm 出血值;pdfPageFormat 含出血等比 216×303mm', () => {
  assert.ok(Math.abs(CSS_PX_PER_MM - 794 / 210) < 1e-9);
  assert.ok(Math.abs(bleedCssPx(3) - (3 * 794) / 210) < 1e-9);
  assert.deepEqual(pdfPageFormat(0), [794, 1123]);
  const [w, h] = pdfPageFormat(3);
  assert.ok(Math.abs(w - (794 + 2 * bleedCssPx(3))) < 1e-9);
  assert.ok(Math.abs(h - (1123 + 2 * bleedCssPx(3))) < 1e-9);
  // 物理比例:含出血宽 / 成品宽 == 216 / 210
  assert.ok(Math.abs(w / 794 - 216 / 210) < 1e-9);
  assert.ok(Math.abs(h / 1123 - (297 + 6) / 297) < 1e-3, '高向 3mm×2 与 A4 297mm 等比');
});

type Draw = { sx: number; sy: number; sw: number; sh: number; dx: number; dy: number; dw: number; dh: number };
function fakeCanvas(w: number, h: number, draws: Draw[]): HTMLCanvasElement {
  return {
    width: w,
    height: h,
    getContext: () => ({
      imageSmoothingEnabled: true,
      drawImage: (
        _src: unknown,
        sx: number, sy: number, sw: number, sh: number,
        dx: number, dy: number, dw: number, dh: number,
      ) => draws.push({ sx, sy, sw, sh, dx, dy, dw, dh }),
    }),
  } as unknown as HTMLCanvasElement;
}

test('extendCanvasEdges:输出尺寸 +2B,原图贴在 (B,B),四边一像素拉伸,四角补齐', () => {
  const draws: Draw[] = [];
  const source = { width: 100, height: 200 } as HTMLCanvasElement;
  const out = extendCanvasEdges(source, 10, (w, h) => fakeCanvas(w, h, draws));
  assert.equal(out.width, 120);
  assert.equal(out.height, 220);
  // 中心:内容零位移零缩放
  assert.ok(
    draws.some((d) => d.sx === 0 && d.sy === 0 && d.sw === 100 && d.sh === 200 && d.dx === 10 && d.dy === 10 && d.dw === 100 && d.dh === 200),
    '原图原尺寸贴在 (B,B)',
  );
  // 四边:最外 1px 行/列 → B 宽条带
  assert.ok(draws.some((d) => d.sy === 0 && d.sh === 1 && d.dy === 0 && d.dh === 10 && d.dx === 10 && d.dw === 100), '上边条');
  assert.ok(draws.some((d) => d.sy === 199 && d.sh === 1 && d.dy === 210 && d.dh === 10 && d.dx === 10 && d.dw === 100), '下边条');
  assert.ok(draws.some((d) => d.sx === 0 && d.sw === 1 && d.dx === 0 && d.dw === 10 && d.dy === 10 && d.dh === 200), '左边条');
  assert.ok(draws.some((d) => d.sx === 99 && d.sw === 1 && d.dx === 110 && d.dw === 10 && d.dy === 10 && d.dh === 200), '右边条');
  // 四角:角落 1px 填充
  assert.ok(draws.some((d) => d.sx === 0 && d.sy === 0 && d.sw === 1 && d.sh === 1 && d.dx === 0 && d.dy === 0 && d.dw === 10 && d.dh === 10), '左上角');
  assert.ok(draws.some((d) => d.sx === 99 && d.sy === 0 && d.sw === 1 && d.sh === 1 && d.dx === 110 && d.dy === 0), '右上角');
  assert.ok(draws.some((d) => d.sx === 0 && d.sy === 199 && d.sw === 1 && d.sh === 1 && d.dx === 0 && d.dy === 210), '左下角');
  assert.ok(draws.some((d) => d.sx === 99 && d.sy === 199 && d.sw === 1 && d.sh === 1 && d.dx === 110 && d.dy === 210), '右下角');
  assert.equal(draws.length, 9, '中心 + 4 边 + 4 角,不多画');
});

test('extendCanvasEdges:bleedPx<=0 原样返回(标准 PDF 路径零改动)', () => {
  const source = { width: 5, height: 5 } as HTMLCanvasElement;
  assert.equal(extendCanvasEdges(source, 0), source);
  assert.equal(extendCanvasEdges(source, -1), source);
});
