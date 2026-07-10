import { Text } from '@react-pdf/renderer';
import { PAGE, PDF_FONTS } from '../constants';
import { PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';
import { resolveThemeCarrier } from '../theme-carrier';

// 旅行相册六宫格内页（PDF 端，与 index.tsx 同一版面 / 同一坐标）。白底覆盖 Shell 暖纸色；
// 行优先编号 image1..image6；底部居中图注（body）。全套文字陶土红 #1c1b18、字体 Inter(interEn)。

const TERRACOTTA = '#1c1b18';

const CELL_W = 230;
const CELL_H = 351;
const COLS = [27, 283, 538];
const ROW_TOP = 28;
const ROW_BOTTOM = 403;

export function PdfMag31({ data, imagePos }: TemplateRenderProps) {
  const d = data as Record<string, string>;
  const bodyTheme = resolveThemeCarrier(data, 'body', 'body');
  return (
    <PdfPageShell>
      {/* 上排：image1 / image2 / image3 */}
      <PdfImage src={d['image1']} style={{ position: 'absolute', left: 27, top: 28, width: 230, height: 351 }} position={imagePos?.['image1']} />
      <PdfImage src={d['image2']} style={{ position: 'absolute', left: 283, top: 28, width: 230, height: 351 }} position={imagePos?.['image2']} />
      <PdfImage src={d['image3']} style={{ position: 'absolute', left: 538, top: 28, width: 230, height: 351 }} position={imagePos?.['image3']} />

      {/* 下排：image4 / image5 / image6 */}
      <PdfImage src={d['image4']} style={{ position: 'absolute', left: 27, top: 403, width: 230, height: 351 }} position={imagePos?.['image4']} />
      <PdfImage src={d['image5']} style={{ position: 'absolute', left: 283, top: 403, width: 230, height: 351 }} position={imagePos?.['image5']} />
      <PdfImage src={d['image6']} style={{ position: 'absolute', left: 538, top: 403, width: 230, height: 351 }} position={imagePos?.['image6']} />

      {/* 底部居中图注 */}
      <Text style={{ position: 'absolute', left: 167, top: 800, width: 460, fontFamily: bodyTheme.pdfFontFamily, fontSize: 18, lineHeight: 1.5, color: bodyTheme.accentColor ?? TERRACOTTA, textAlign: 'center' }}>{d['body']}</Text>
    </PdfPageShell>
  );
}
