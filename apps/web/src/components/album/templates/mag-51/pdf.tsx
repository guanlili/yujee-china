import { Text, View } from '@react-pdf/renderer';
import { PAGE, PDF_FONTS } from '../constants';
import { PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';
import { resolveThemeCarrier } from '../theme-carrier';

// 内页 · 顶部大标题 + 满幅竖图（PDF 端，与 index.tsx 同一版面 / 同一坐标）。白底覆盖 Shell 暖纸色；
// 顶部一行陶土红超大地名主标题，下方一张满幅竖向大图。文字陶土红 #1c1b18，字体 Inter。
// 版式来自「排版板式」旅行相册库 Figma 稿 A4-24 (node 12:255)（595×842 → ×1.3344 → 794×1123）。

const INK = '#1c1b18';

export function PdfMag51({ data, imagePos }: TemplateRenderProps) {
  const d = data as Record<string, string>;
  const title = d['title'] || 'NORWAY';
  const titleTheme = resolveThemeCarrier(data, 'title', 'title');
  return (
    <PdfPageShell>
      {/* 纯白底（覆盖 Shell 暖纸色） */}
      <View style={{ position: 'absolute', left: 0, top: 0, width: PAGE.width, height: PAGE.height, backgroundColor: '#FFFFFF' }} />

      {/* 顶部超大地名主标题（槽 title，variableDecor） */}
      <Text style={{ position: 'absolute', left: 60, top: 44, width: 734, fontFamily: titleTheme.pdfFontFamily, fontWeight: 'bold', fontSize: 92, lineHeight: 1, letterSpacing: 2, color: titleTheme.accentColor ?? INK }}>{title}</Text>

      {/* 满幅竖向大图（槽 image） */}
      <PdfImage src={d['image']} style={{ position: 'absolute', left: 60, top: 120, width: 674, height: 917 }} position={imagePos?.['image']} />
    </PdfPageShell>
  );
}
