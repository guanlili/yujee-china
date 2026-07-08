import { Text, View } from '@react-pdf/renderer';
import { PAGE, PDF_FONTS } from '../constants';
import { PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';
import { resolveThemeCarrier } from '../theme-carrier';

// 封面（PDF 端，与 index.tsx 同一版面 / 同一坐标）。白底覆盖 Shell 暖纸色；
// 主标题 / 副标题为 lang=user，按内容有无中文在 montserrat(英) 与 sansCn(中) 间切换，避免豆腐块；
// year/city 走 sansCn（英文小字，中英通吃，换行分隔）。M / Year / City / 装饰方块固定、不进契约。

const INK = '#1c1b18';
const hasCjk = (s: string | undefined) => /[一-鿿]/.test(s || '');

export function PdfMag23({ data, imagePos }: TemplateRenderProps) {
  const d = data as Record<string, string>;
  const titleFont = hasCjk(d['title']) ? PDF_FONTS.sansCn : PDF_FONTS.montserrat;
  const subtitleFont = hasCjk(d['subtitle']) ? PDF_FONTS.sansCn : PDF_FONTS.montserrat;
  const yearTheme = resolveThemeCarrier(data, 'year');
  const cityTheme = resolveThemeCarrier(data, 'city');
  const titleTheme = resolveThemeCarrier(data, 'title');
  const subtitleTheme = resolveThemeCarrier(data, 'subtitle');
  return (
    <PdfPageShell>
      {/* 纯白底（覆盖 Shell 暖纸色） */}
      <View style={{ position: 'absolute', left: 0, top: 0, width: PAGE.width, height: PAGE.height, backgroundColor: '#FFFFFF' }} />

      {/* ── 固定装饰：左上四个渐深小方块（furniture，非槽位） ── */}
      <View style={{ position: 'absolute', left: 67, top: 67, width: 13, height: 13, backgroundColor: 'rgba(0,0,0,0.15)' }} />
      <View style={{ position: 'absolute', left: 81, top: 67, width: 13, height: 13, backgroundColor: 'rgba(0,0,0,0.35)' }} />
      <View style={{ position: 'absolute', left: 95, top: 67, width: 13, height: 13, backgroundColor: 'rgba(0,0,0,0.65)' }} />
      <View style={{ position: 'absolute', left: 108, top: 67, width: 13, height: 13, backgroundColor: 'rgba(0,0,0,0.9)' }} />

      {/* ── 固定装饰：右上角「M」角标（furniture，非槽位） ── */}
      <Text style={{ position: 'absolute', left: 723, top: 60, fontFamily: PDF_FONTS.sansCn, fontWeight: 'bold', fontSize: 16, lineHeight: 1, color: INK }}>M</Text>

      {/* ── 固定标签「Year」「City」（furniture，非槽位） ── */}
      <Text style={{ position: 'absolute', left: 427, top: 125, fontFamily: PDF_FONTS.sansCn, fontSize: 12, lineHeight: 1, color: INK }}>Year</Text>
      <Text style={{ position: 'absolute', left: 536, top: 125, fontFamily: PDF_FONTS.sansCn, fontSize: 12, lineHeight: 1, color: INK }}>City</Text>

      {/* ── 年份列表（槽 year，换行分隔） ── */}
      <Text style={{ position: 'absolute', left: 467, top: 123, width: 60, fontFamily: PDF_FONTS.sansCn, fontSize: 12, lineHeight: 1.6, color: yearTheme.accentColor ?? INK }}>{d['year']}</Text>

      {/* ── 城市列表（槽 city，换行分隔） ── */}
      <Text style={{ position: 'absolute', left: 576, top: 123, width: 130, fontFamily: PDF_FONTS.sansCn, fontSize: 12, lineHeight: 1.6, color: cityTheme.accentColor ?? INK }}>{d['city']}</Text>

      {/* ── 主标题（槽 title，宽体展示字） ── */}
      <Text style={{ position: 'absolute', left: 57, top: 201, width: 400, fontFamily: titleFont, fontWeight: 'bold', fontSize: 75, lineHeight: 1, letterSpacing: 4.5, color: titleTheme.accentColor ?? INK }}>{d['title']}</Text>

      {/* ── 副标题（槽 subtitle，略小） ── */}
      <Text style={{ position: 'absolute', left: 67, top: 287, width: 300, fontFamily: subtitleFont, fontWeight: 'bold', fontSize: 53, lineHeight: 1, letterSpacing: 3.2, color: subtitleTheme.accentColor ?? INK }}>{d['subtitle']}</Text>

      {/* ── 固定装饰：中部小方块（furniture，非槽位） ── */}
      <View style={{ position: 'absolute', left: 354, top: 327, width: 13, height: 13, backgroundColor: 'rgba(0,0,0,0.8)' }} />

      {/* ── 封面大图（槽 image，cover） ── */}
      <PdfImage src={d['image']} style={{ position: 'absolute', left: 55, top: 353, width: 685, height: 728 }} position={imagePos?.['image']} />
    </PdfPageShell>
  );
}
