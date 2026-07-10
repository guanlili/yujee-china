import { Text, View } from '@react-pdf/renderer';
import { PAGE, PDF_FONTS } from '../constants';
import { PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';
import { resolveThemeCarrier } from '../theme-carrier';

// 封面（PDF 端，与 index.tsx 同一版面 / 同一坐标）。白底覆盖 Shell 暖纸色；
// 满高大图（偏右）铺满整页；左下大号主标题；左缘竖排大地名 NORWAY。文字全为陶土红 #1c1b18、Inter。
// 竖排文字用 @react-pdf 的 transform rotate(90deg) + transformOrigin 'top left' 近似 web（同向、自上而下）。
// 偏差说明：@react-pdf 的 rotate 不带子像素度量补偿，竖排起点/letterSpacing 与 web 可能有数 px 视觉偏移，整体阅读方向与版位一致。
// 取舍同 web：主竖排大 NORWAY 为 label 槽（可填）；另两处小 NORWAY 为固定 furniture（写死、不进契约）。

const CLAY = '#1c1b18';

export function PdfMag32({ data, imagePos }: TemplateRenderProps) {
  const d = data as Record<string, string>;
  const label = d['label'] || 'NORWAY';
  const labelTheme = resolveThemeCarrier(data, 'label', 'decoration');
  const titleTheme = resolveThemeCarrier(data, 'title', 'title');
  return (
    <PdfPageShell>
      {/* 纯白底（覆盖 Shell 暖纸色） */}
      <View style={{ position: 'absolute', left: 0, top: 0, width: PAGE.width, height: PAGE.height, backgroundColor: '#FFFFFF' }} />

      {/* ── 封面满高大图（槽 image，偏右铺满整页高度） ── */}
      <PdfImage src={d['image']} style={{ position: 'absolute', left: 103, top: 0, width: 691, height: 1123 }} position={imagePos?.['image']} />

      {/* ── 主竖排大地名 NORWAY（槽 label，左缘 rotate 90°，variableDecor） ── */}
      <View style={{ position: 'absolute', left: 18, top: 160, transform: 'rotate(90deg)', transformOrigin: 'top left' }}>
        <Text style={{ width: 800, fontFamily: labelTheme.pdfFontFamily, fontWeight: 'bold', fontSize: 85, lineHeight: 1, letterSpacing: 8.5, color: labelTheme.accentColor ?? CLAY }}>{label}</Text>
      </View>

      {/* ── 主标题（槽 title，左下角大展示字） ── */}
      <Text style={{ position: 'absolute', left: 56, top: 710, width: 300, fontFamily: titleTheme.pdfFontFamily, fontWeight: 'bold', fontSize: 96, lineHeight: 1.05, color: titleTheme.accentColor ?? CLAY }}>{d['title']}</Text>

      {/* ── 固定装饰：左下竖排小 NORWAY（furniture，非槽位，rotate 90°） ── */}
      <View style={{ position: 'absolute', left: 50, top: 760, transform: 'rotate(90deg)', transformOrigin: 'top left' }}>
        <Text style={{ width: 300, fontFamily: PDF_FONTS.interEn, fontSize: 43, lineHeight: 1, letterSpacing: 4, color: CLAY }}>{label}</Text>
      </View>

      {/* ── 固定装饰：底部横排小 NORWAY（furniture，非槽位） ── */}
      <Text style={{ position: 'absolute', left: 56, top: 1066, width: 300, fontFamily: PDF_FONTS.interEn, fontSize: 43, lineHeight: 1, letterSpacing: 4, color: CLAY }}>{label}</Text>
    </PdfPageShell>
  );
}
