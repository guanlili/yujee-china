import { Text, View } from '@react-pdf/renderer';
import { PAGE, PDF_FONTS } from '../constants';
import { PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';
import { resolveThemeCarrier } from '../theme-carrier';

// 三联横图内页（PDF 端，与 index.tsx 同一版面 / 同一坐标）。白底覆盖 Shell 暖纸色；
// 三张等大横图垂直堆叠，左侧竖排大字标题，每张图右侧小图注。
// 文字含中文时切到 serifCn（Noto SC）避免豆腐块，纯英文走 interEn（Inter，与 web 一致）。
// 全套文字 #1c1b18。
// 来自 Figma A4-2 (node 5:21)，595×842 → ×1.3344 → 794×1123。

const INK = '#1c1b18';
const hasCjk = (s: string | undefined) => /[一-鿿]/.test(s || '');

export function PdfMag33({ data, imagePos }: TemplateRenderProps) {
  const d = data as Record<string, string>;
  const titleFont = hasCjk(d['title']) ? PDF_FONTS.serifCn : PDF_FONTS.interEn;
  const cap1Font = hasCjk(d['caption1']) ? PDF_FONTS.serifCn : PDF_FONTS.interEn;
  const cap2Font = hasCjk(d['caption2']) ? PDF_FONTS.serifCn : PDF_FONTS.interEn;
  const cap3Font = hasCjk(d['caption3']) ? PDF_FONTS.serifCn : PDF_FONTS.interEn;
  const titleTheme = resolveThemeCarrier(data, 'title');
  const caption1Theme = resolveThemeCarrier(data, 'caption1');
  const caption2Theme = resolveThemeCarrier(data, 'caption2');
  const caption3Theme = resolveThemeCarrier(data, 'caption3');
  return (
    <PdfPageShell>
      {/* 纯白底（覆盖 Shell 暖纸色） */}
      <View style={{ position: 'absolute', left: 0, top: 0, width: PAGE.width, height: PAGE.height, backgroundColor: '#FFFFFF' }} />

      {/* 三张等大横图（垂直堆叠） */}
      <PdfImage src={d['image1']} style={{ position: 'absolute', left: 200, top: 159, width: 376, height: 247 }} position={imagePos?.['image1']} />
      <PdfImage src={d['image2']} style={{ position: 'absolute', left: 200, top: 438, width: 376, height: 247 }} position={imagePos?.['image2']} />
      <PdfImage src={d['image3']} style={{ position: 'absolute', left: 200, top: 717, width: 376, height: 247 }} position={imagePos?.['image3']} />

      {/* 左侧竖排大字标题（在三联图左侧留白） */}
      <Text style={{ position: 'absolute', left: 28, top: 159, width: 150, fontFamily: titleFont, fontWeight: 'bold', fontSize: 44, lineHeight: 1.05, color: titleTheme.accentColor ?? INK }}>{d['title']}</Text>

      {/* 每张图右侧小图注（在右侧留白） */}
      <Text style={{ position: 'absolute', left: 596, top: 159, width: 178, fontFamily: cap1Font, fontSize: 16, lineHeight: 1.35, color: caption1Theme.accentColor ?? INK }}>{d['caption1']}</Text>
      <Text style={{ position: 'absolute', left: 596, top: 438, width: 178, fontFamily: cap2Font, fontSize: 16, lineHeight: 1.35, color: caption2Theme.accentColor ?? INK }}>{d['caption2']}</Text>
      <Text style={{ position: 'absolute', left: 596, top: 717, width: 178, fontFamily: cap3Font, fontSize: 16, lineHeight: 1.35, color: caption3Theme.accentColor ?? INK }}>{d['caption3']}</Text>
    </PdfPageShell>
  );
}
