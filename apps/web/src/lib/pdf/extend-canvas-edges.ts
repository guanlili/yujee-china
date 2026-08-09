/* PDF 出血纯函数层(2026-08-03 设计:docs/specs/2026-08-03-pdf-bleed-export-design.md)。
   出血 = 边缘延伸:页内容零位移零缩放,最外 1px 像素拉伸填满出血条带 —— 裁切机
   ±1-2mm 漂移时露出的是颜色延续而不是白边。 */

// A4 页面像素基准:页面 794 CSS px ↔ 成品 210mm(templates/constants.PAGE 同源,
// 不 import 避免把模板常量拖进纯函数层)。
export const CSS_PX_PER_MM = 794 / 210;

export function bleedCssPx(bleedMm: number): number {
  return bleedMm * CSS_PX_PER_MM;
}

// jsPDF 页面尺寸(CSS px,浮点保物理比例精确):3mm 出血即等比 216×303mm。
export function pdfPageFormat(bleedMm: number): [number, number] {
  const b = bleedCssPx(bleedMm);
  return [794 + 2 * b, 1123 + 2 * b];
}

/** 画布四边各加 bleedPx:中间贴原图,最外 1px 行/列拉伸成边条,四角用角像素填。
 *  bleedPx <= 0 原样返回 source(标准 PDF 路径零改动)。createCanvas 可注入(测试
 *  用假画布记录 drawImage 几何;node 无真 canvas)。 */
export function extendCanvasEdges(
  source: HTMLCanvasElement,
  bleedPx: number,
  createCanvas: (w: number, h: number) => HTMLCanvasElement = (w, h) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  },
): HTMLCanvasElement {
  if (bleedPx <= 0) return source;
  const B = Math.round(bleedPx);
  const W = source.width;
  const H = source.height;
  const out = createCanvas(W + 2 * B, H + 2 * B);
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  // 中心:内容零位移零缩放
  ctx.drawImage(source, 0, 0, W, H, B, B, W, H);
  // 四边:最外 1px 行/列拉伸成 B 宽条带
  ctx.drawImage(source, 0, 0, W, 1, B, 0, W, B); // 上
  ctx.drawImage(source, 0, H - 1, W, 1, B, H + B, W, B); // 下
  ctx.drawImage(source, 0, 0, 1, H, 0, B, B, H); // 左
  ctx.drawImage(source, W - 1, 0, 1, H, W + B, B, B, H); // 右
  // 四角:角落 1px 填充
  ctx.drawImage(source, 0, 0, 1, 1, 0, 0, B, B);
  ctx.drawImage(source, W - 1, 0, 1, 1, W + B, 0, B, B);
  ctx.drawImage(source, 0, H - 1, 1, 1, 0, H + B, B, B);
  ctx.drawImage(source, W - 1, H - 1, 1, 1, W + B, H + B, B, B);
  return out;
}
