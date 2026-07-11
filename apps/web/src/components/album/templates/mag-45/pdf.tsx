import { Text, View } from '@react-pdf/renderer';
import { fitDisplayFontSize, PAGE, PDF_FONTS } from '../constants';
import { PdfImage, PdfPageShell } from '../pdf-utils';
import { resolveThemeCarrier } from '../theme-carrier';
import type { TemplateRenderProps } from '../types';

// 内页（PDF 端，与 index.tsx 同一版面 / 同一坐标）。来自 A4-17 (node 12:47)。
// 白底覆盖 Shell 暖纸色；上方一张居中竖图（槽 image）；底部一行大号展示主标题（槽 title，variableDecor）。
// 文字全为墨色 #1c1b18、Inter（不换花字体）。
// 几何同 web：图 (148,35,606×927)；标题 (31,969,723×155)，fontSize 120。

const INK = '#1c1b18';

export function PdfMag45({ data, imagePos }: TemplateRenderProps) {
  const d = data as Record<string, string>;
  const title = d['title'] || 'Watermelon';
  const titleTheme = resolveThemeCarrier(data, 'title', 'title');
  return (
    <PdfPageShell>
      {/* 纯白底（覆盖 Shell 暖纸色） */}
      <View style={{ position: 'absolute', left: 0, top: 0, width: PAGE.width, height: PAGE.height, backgroundColor: '#FFFFFF' }} />

      {/* ── 居中大图（槽 image，竖图） ── */}
      <PdfImage src={d['image']} style={{ position: 'absolute', left: 148, top: 35, width: 606, height: 927 }} position={imagePos?.['image']} />

      {/* ── 底部大号主标题（槽 title，variableDecor） ── */}
      <Text style={{ position: 'absolute', left: 31, top: 969, width: 723, fontFamily: titleTheme.pdfFontFamily, fontWeight: 'bold', fontSize: fitDisplayFontSize(title, 700, 120, 40), lineHeight: 1, color: titleTheme.accentColor ?? INK }}>{title}</Text>
    </PdfPageShell>
  );
}
