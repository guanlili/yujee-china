import { Text, View } from '@react-pdf/renderer';
import { PAGE, PDF_FONTS } from '../constants';
import { PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';

// 顶部超大标题 + 单张近方大图内页（PDF 端，与 index.tsx 同一版面 / 同一坐标）。白底覆盖 Shell 暖纸色；
// 页顶横排超大主标题（槽 title，占位「NORWAY」，首字母 N 略大）；标题负空间嵌固定骨架标签
// when / where / who / what（写死 furniture，不进契约）；中下部一张近方大图。
// 标题含中文时切到 serifCn（Noto SC）避免豆腐块，纯英文走 interEn（Inter，与 web 一致）。
// 全套文字陶土红 #1c1b18。版式来自 Figma 稿 A4-22（node 12:228）。

const INK = '#1c1b18';
const hasCjk = (s: string | undefined) => /[一-鿿]/.test(s || '');

export function PdfMag49({ data, imagePos }: TemplateRenderProps) {
  const d = data as Record<string, string>;
  const title = d['title'] || 'NORWAY';
  const head = title.charAt(0);
  const rest = title.slice(1);
  const titleFont = hasCjk(title) ? PDF_FONTS.serifCn : PDF_FONTS.interEn;
  return (
    <PdfPageShell>
      {/* 纯白底（覆盖 Shell 暖纸色） */}
      <View style={{ position: 'absolute', left: 0, top: 0, width: PAGE.width, height: PAGE.height, backgroundColor: '#FFFFFF' }} />

      {/* ── 顶部超大主标题（槽 title，占位 NORWAY，首字母略大，variableDecor） ── */}
      <View style={{ position: 'absolute', left: 28, top: 150, width: 738, height: 155, flexDirection: 'row', alignItems: 'flex-end' }}>
        <Text style={{ fontFamily: titleFont, fontWeight: 'bold', fontSize: 155, lineHeight: 1, color: INK }}>{head}</Text>
        <Text style={{ fontFamily: titleFont, fontWeight: 'bold', fontSize: 124, lineHeight: 1, color: INK }}>{rest}</Text>
      </View>

      {/* ── 固定骨架标签 when / where / who / what（furniture，2×2，非槽位） ── */}
      <Text style={{ position: 'absolute', left: 119, top: 44, fontFamily: PDF_FONTS.interEn, fontSize: 21, lineHeight: 1.2, color: INK }}>when</Text>
      <Text style={{ position: 'absolute', left: 239, top: 44, fontFamily: PDF_FONTS.interEn, fontSize: 21, lineHeight: 1.2, color: INK }}>where</Text>
      <Text style={{ position: 'absolute', left: 119, top: 70, fontFamily: PDF_FONTS.interEn, fontSize: 21, lineHeight: 1.2, color: INK }}>who</Text>
      <Text style={{ position: 'absolute', left: 239, top: 70, fontFamily: PDF_FONTS.interEn, fontSize: 21, lineHeight: 1.2, color: INK }}>what</Text>

      {/* ── 中下部近方大图（槽 image） ── */}
      <PdfImage src={d['image']} style={{ position: 'absolute', left: 28, top: 306, width: 674, height: 699 }} position={imagePos?.['image']} />
    </PdfPageShell>
  );
}
