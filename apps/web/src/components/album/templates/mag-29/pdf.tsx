import { Text, View } from '@react-pdf/renderer';
import { PAGE, PDF_FONTS } from '../constants';
import { PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';

// 旅行相册内页（PDF 端，与 index.tsx 同一版面 / 同一坐标）。白底覆盖 Shell 暖纸色；
// 全套文字陶土红 #1c1b18。title 为 lang=user，按内容有无中文在 interEn(英) 与 sansCn(中)
// 间切换，避免中文豆腐块；body(user) 走 sansCn（中英通吃）；label(en) 固定 interEn。
// 右对齐元素用 textAlign:right，与 web 一致。

const CLAY = '#1c1b18';
const hasCjk = (s: string | undefined) => /[一-鿿]/.test(s || '');

export function PdfMag29({ data, imagePos }: TemplateRenderProps) {
  const d = data as Record<string, string>;
  const titleFont = hasCjk(d['title']) ? PDF_FONTS.sansCn : PDF_FONTS.interEn;
  return (
    <PdfPageShell>
      {/* 纯白底（覆盖 Shell 暖纸色） */}
      <View style={{ position: 'absolute', left: 0, top: 0, width: PAGE.width, height: PAGE.height, backgroundColor: '#FFFFFF' }} />

      {/* 上方并排双图 */}
      <PdfImage src={d['image1']} style={{ position: 'absolute', left: 28, top: 67, width: 330, height: 464 }} position={imagePos?.['image1']} />
      <PdfImage src={d['image2']} style={{ position: 'absolute', left: 362, top: 67, width: 330, height: 464 }} position={imagePos?.['image2']} />

      {/* 右对齐大标题 */}
      <Text style={{ position: 'absolute', left: 49, top: 694, width: 726, fontFamily: titleFont, fontWeight: 'bold', fontSize: 64, lineHeight: 1.1, color: CLAY, textAlign: 'right' }}>{d['title']}</Text>

      {/* 右对齐图注 */}
      <Text style={{ position: 'absolute', left: 347, top: 762, width: 431, fontFamily: PDF_FONTS.sansCn, fontSize: 21, lineHeight: 1.5, color: CLAY, textAlign: 'right' }}>{d['body']}</Text>

      {/* 右对齐地名（装饰标签） */}
      <Text style={{ position: 'absolute', left: 49, top: 1007, width: 726, fontFamily: PDF_FONTS.interEn, fontWeight: 'bold', fontSize: 48, lineHeight: 1.1, color: CLAY, textAlign: 'right' }}>{d['label']}</Text>
    </PdfPageShell>
  );
}
