import { Text, View } from '@react-pdf/renderer';
import { PAGE, PDF_FONTS } from '../constants';
import { PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';

// 上下满版双图叠字内页（PDF 端，与 index.tsx 同一版面 / 同一坐标）。来自 A4-13 (node 11:485)。
// 白底覆盖 Shell 暖纸色；上下两块满宽图，中间居中陶土色大字陈述句跨在两图交界处。
// 文字含中文时切到 serifCn（Noto SC）避免豆腐块，纯英文走 interEn（Inter，与 web 一致）。
// 全套文字 #1c1b18。

const INK = '#1c1b18';
const hasCjk = (s: string | undefined) => /[一-鿿]/.test(s || '');

export function PdfMag38({ data, imagePos }: TemplateRenderProps) {
  const d = data as Record<string, string>;
  const bodyFont = hasCjk(d['body']) ? PDF_FONTS.serifCn : PDF_FONTS.interEn;
  return (
    <PdfPageShell>
      {/* 纯白底（覆盖 Shell 暖纸色） */}
      <View style={{ position: 'absolute', left: 0, top: 0, width: PAGE.width, height: PAGE.height, backgroundColor: '#FFFFFF' }} />

      {/* 上方满宽图（先渲染，文字叠其上） */}
      <PdfImage src={d['image1']} style={{ position: 'absolute', left: 0, top: 0, width: 794, height: 511 }} position={imagePos?.['image1']} />

      {/* 下方满宽图 */}
      <PdfImage src={d['image2']} style={{ position: 'absolute', left: 0, top: 511, width: 794, height: 612 }} position={imagePos?.['image2']} />

      {/* 居中大字陈述句（跨在两图交界处） */}
      <Text style={{ position: 'absolute', left: 87, top: 284, width: 620, textAlign: 'center', fontFamily: bodyFont, fontWeight: 'bold', fontSize: 48, lineHeight: 1.15, color: INK }}>{d['body']}</Text>
    </PdfPageShell>
  );
}
