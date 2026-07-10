import { Text, View } from '@react-pdf/renderer';
import { PAGE, PDF_FONTS } from '../constants';
import { PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';
import { resolveThemeCarrier } from '../theme-carrier';

// 错落四图 + 左上叙事文内页（PDF 端，与 index.tsx 同一版面 / 同一坐标）。来自 A4-19 (node 12:66)。
// 白底覆盖 Shell 暖纸色；四张等大横图错落（image1 右上 / image2 左中 / image3 右下 / image4 左下），
// 左上大字标题 + 小字图注段。文字含中文走 serifCn(Noto SC) 避免豆腐块，纯英文走 interEn(Inter，与 web 一致)。
// 全套文字墨色 #1c1b18。

const INK = '#1c1b18';

export function PdfMag47({ data, imagePos }: TemplateRenderProps) {
  const d = data as Record<string, string>;
  const titleTheme = resolveThemeCarrier(data, 'title', 'title');
  const explainTheme = resolveThemeCarrier(data, 'explain', 'explain');
  return (
    <PdfPageShell>
      {/* 纯白底（覆盖 Shell 暖纸色） */}
      <View style={{ position: 'absolute', left: 0, top: 0, width: PAGE.width, height: PAGE.height, backgroundColor: '#FFFFFF' }} />

      {/* 四张错落横图 */}
      <PdfImage src={d['image1']} style={{ position: 'absolute', left: 446, top: 296, width: 320, height: 235 }} position={imagePos?.['image1']} />
      <PdfImage src={d['image2']} style={{ position: 'absolute', left: 89, top: 468, width: 320, height: 235 }} position={imagePos?.['image2']} />
      <PdfImage src={d['image3']} style={{ position: 'absolute', left: 446, top: 567, width: 320, height: 235 }} position={imagePos?.['image3']} />
      <PdfImage src={d['image4']} style={{ position: 'absolute', left: 89, top: 739, width: 320, height: 235 }} position={imagePos?.['image4']} />

      {/* 左上大字主标题 */}
      <Text style={{ position: 'absolute', left: 89, top: 296, width: 480, fontFamily: titleTheme.pdfFontFamily, fontWeight: 'bold', fontSize: 33, lineHeight: 1.1, color: titleTheme.accentColor ?? INK }}>{d['title']}</Text>

      {/* 标题下方小字图注段 */}
      <Text style={{ position: 'absolute', left: 89, top: 368, width: 396, fontFamily: explainTheme.pdfFontFamily, fontSize: 18, lineHeight: 1.4, color: explainTheme.accentColor ?? INK }}>{d['explain']}</Text>
    </PdfPageShell>
  );
}
