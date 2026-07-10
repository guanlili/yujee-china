import { Text, View } from '@react-pdf/renderer';
import { PAGE, PDF_FONTS } from '../constants';
import { PdfImage, PdfPageShell } from '../pdf-utils';
import { resolveThemeCarrier } from '../theme-carrier';
import type { TemplateRenderProps } from '../types';

// 来自 A4-16 (node 12:46)。大字拼贴内页（PDF 端，与 index.tsx 同一版面 / 同一坐标）。
// 白底覆盖 Shell 暖纸色；左上超大字主标题，右上 + 左下两张竖图错落，中部短句、右下图注。
// 文字含中文走 serifCn（Noto SC）避免豆腐块，纯英文走 interEn（Inter，与 web 一致）。
// 全套文字 #1c1b18。

const INK = '#1c1b18';

export function PdfMag44({ data, imagePos }: TemplateRenderProps) {
  const d = data as Record<string, string>;
  const titleTheme = resolveThemeCarrier(data, 'title', 'title');
  const lineTheme = resolveThemeCarrier(data, 'line', 'explain');
  const captionTheme = resolveThemeCarrier(data, 'caption', 'explain');
  return (
    <PdfPageShell>
      {/* 纯白底（覆盖 Shell 暖纸色） */}
      <View style={{ position: 'absolute', left: 0, top: 0, width: PAGE.width, height: PAGE.height, backgroundColor: '#FFFFFF' }} />

      {/* 右上竖图（12:51） */}
      <PdfImage src={d['image1']} style={{ position: 'absolute', left: 438, top: 28, width: 356, height: 527 }} position={imagePos?.['image1']} />

      {/* 左下竖图（12:53） */}
      <PdfImage src={d['image2']} style={{ position: 'absolute', left: 28, top: 555, width: 364, height: 536 }} position={imagePos?.['image2']} />

      {/* 左上超大字主标题（12:55 "Notes"） */}
      <Text style={{ position: 'absolute', left: 28, top: 28, width: 480, fontFamily: titleTheme.pdfFontFamily, fontWeight: 'bold', fontSize: 108, lineHeight: 1.0, color: titleTheme.accentColor ?? INK }}>{d['title']}</Text>

      {/* 中部一行短句（12:57） */}
      <Text style={{ position: 'absolute', left: 28, top: 508, width: 334, fontFamily: lineTheme.pdfFontFamily, fontSize: 21, lineHeight: 1.35, color: lineTheme.accentColor ?? INK }}>{d['line']}</Text>

      {/* 右下角图注段（12:59） */}
      <Text style={{ position: 'absolute', left: 405, top: 965, width: 356, fontFamily: captionTheme.pdfFontFamily, fontSize: 21, lineHeight: 1.35, color: captionTheme.accentColor ?? INK }}>{d['caption']}</Text>
    </PdfPageShell>
  );
}
