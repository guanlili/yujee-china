import { Text, View } from '@react-pdf/renderer';
import { PAGE, PDF_FONTS } from '../constants';
import { PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';
import { resolveThemeCarrier } from '../theme-carrier';

// 满版大图叠字内页（PDF 端，与 index.tsx 同一版面 / 同一坐标）。白底覆盖 Shell 暖纸色；
// 右侧满高大图，左侧陶土红大字（主标题 + 陈述句）与小图注叠在图上方。
// 文字含中文时切到 serifCn（Noto SC）避免豆腐块，纯英文走 interEn（Inter，与 web 一致）。
// 全套文字陶土红 #1c1b18。

const TERRACOTTA = '#1c1b18';

export function PdfMag28({ data, imagePos }: TemplateRenderProps) {
  const d = data as Record<string, string>;
  const titleTheme = resolveThemeCarrier(data, 'title', 'title');
  const headlineTheme = resolveThemeCarrier(data, 'headline', 'title');
  const explainTheme = resolveThemeCarrier(data, 'explain', 'explain');
  return (
    <PdfPageShell>
      {/* 纯白底（覆盖 Shell 暖纸色） */}
      <View style={{ position: 'absolute', left: 0, top: 0, width: PAGE.width, height: PAGE.height, backgroundColor: '#FFFFFF' }} />

      {/* 右侧满高大图（先渲染，文字叠其上） */}
      <PdfImage src={d['image']} style={{ position: 'absolute', left: 133, top: 67, width: 661, height: 990 }} position={imagePos?.['image']} />

      {/* 左侧大字主标题（叠在图上方） */}
      <Text style={{ position: 'absolute', left: 28, top: 69, width: 627, fontFamily: titleTheme.pdfFontFamily, fontWeight: 'bold', fontSize: 64, lineHeight: 1.05, color: titleTheme.accentColor ?? TERRACOTTA }}>{d['title']}</Text>

      {/* 左侧大字陈述句 / 引语（叠在图上方） */}
      <Text style={{ position: 'absolute', left: 28, top: 307, width: 627, fontFamily: headlineTheme.pdfFontFamily, fontWeight: 'bold', fontSize: 64, lineHeight: 1.05, color: headlineTheme.accentColor ?? TERRACOTTA }}>{d['headline']}</Text>

      {/* 左下角小图注 */}
      <Text style={{ position: 'absolute', left: 28, bottom: 66, width: 255, fontFamily: explainTheme.pdfFontFamily, fontSize: 21, lineHeight: 1.35, color: explainTheme.accentColor ?? TERRACOTTA }}>{d['explain']}</Text>
    </PdfPageShell>
  );
}
