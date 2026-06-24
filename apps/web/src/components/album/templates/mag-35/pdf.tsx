import { Text, View } from '@react-pdf/renderer';
import { PAGE, PDF_FONTS } from '../constants';
import { PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';

// 满版绿底收束页（PDF 端，与 index.tsx 同一版面 / 同一坐标）。整页绿色底块 #81a46d 覆盖
// Shell 暖纸色；左上 / 右上一对小标签，中部偏左竖图，图下散文式收束语。
// 文字含中文时切到 serifCn（Noto SC）避免豆腐块，纯英文走 interEn（Inter，与 web 一致）。
// 全套文字墨色 #1c1b18。版式来自 A4-6（node 11:263）。

const INK = '#1c1b18';
const hasCjk = (s: string | undefined) => /[一-鿿]/.test(s || '');

export function PdfMag35({ data, imagePos }: TemplateRenderProps) {
  const d = data as Record<string, string>;
  const labelFont = hasCjk(d['label']) ? PDF_FONTS.serifCn : PDF_FONTS.interEn;
  const dateFont = hasCjk(d['date']) ? PDF_FONTS.serifCn : PDF_FONTS.interEn;
  const bodyFont = hasCjk(d['body']) ? PDF_FONTS.serifCn : PDF_FONTS.interEn;
  return (
    <PdfPageShell>
      {/* 整页绿色底块（覆盖 Shell 暖纸色，Figma Rectangle 7 满版填充 #81a46d） */}
      <View style={{ position: 'absolute', left: 0, top: 0, width: PAGE.width, height: PAGE.height, backgroundColor: '#81a46d' }} />

      {/* 竖图（先渲染，文字叠其上） */}
      <PdfImage src={d['image']} style={{ position: 'absolute', left: 148, top: 160, width: 318, height: 408 }} position={imagePos?.['image']} />

      {/* 左上小标签 */}
      <Text style={{ position: 'absolute', left: 156, top: 160, width: 135, fontFamily: labelFont, fontSize: 21, lineHeight: 1.3, color: INK }}>{d['label']}</Text>

      {/* 右上日期小标签（右对齐） */}
      <Text style={{ position: 'absolute', left: 330, top: 160, width: 135, textAlign: 'right', fontFamily: dateFont, fontSize: 21, lineHeight: 1.3, color: INK }}>{d['date']}</Text>

      {/* 图下散文式收束语 */}
      <Text style={{ position: 'absolute', left: 156, top: 220, width: 242, fontFamily: bodyFont, fontSize: 21, lineHeight: 1.35, color: INK }}>{d['body']}</Text>
    </PdfPageShell>
  );
}
