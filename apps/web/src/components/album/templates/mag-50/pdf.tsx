import { Text, View } from '@react-pdf/renderer';
import { PAGE, PDF_FONTS } from '../constants';
import { PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';

// 拼贴三图 + 右下角标签骨架内页（PDF 端，与 index.tsx 同一版面 / 同一坐标）。白底覆盖 Shell 暖纸色；
// 三张矩形图错落拼贴，右下角固定骨架标签词 when/where/who/what（硬编码 furniture），下方叠全大写主标题。
// 标题含中文时切到 serifCn（Noto SC）避免豆腐块，纯英文走 interEn（Inter，与 web 一致）。
// 全套文字 #1c1b18。版式来自 A4-23 (node 12:229)。

const INK = '#1c1b18';
const hasCjk = (s: string | undefined) => /[一-鿿]/.test(s || '');

export function PdfMag50({ data, imagePos }: TemplateRenderProps) {
  const d = data as Record<string, string>;
  const titleFont = hasCjk(d['title']) ? PDF_FONTS.serifCn : PDF_FONTS.interEn;
  const label = (left: number, top: number, txt: string) => (
    <Text style={{ position: 'absolute', left, top, fontFamily: PDF_FONTS.interEn, fontSize: 18, lineHeight: 1.0, color: INK }}>{txt}</Text>
  );
  return (
    <PdfPageShell>
      {/* 纯白底（覆盖 Shell 暖纸色） */}
      <View style={{ position: 'absolute', left: 0, top: 0, width: PAGE.width, height: PAGE.height, backgroundColor: '#FFFFFF' }} />

      {/* 左侧满高竖图 */}
      <PdfImage src={d['image1']} style={{ position: 'absolute', left: 0, top: 382, width: 224, height: 742 }} position={imagePos?.['image1']} />

      {/* 中部横图 */}
      <PdfImage src={d['image2']} style={{ position: 'absolute', left: 173, top: 510, width: 263, height: 195 }} position={imagePos?.['image2']} />

      {/* 右上竖图 */}
      <PdfImage src={d['image3']} style={{ position: 'absolute', left: 504, top: 119, width: 263, height: 427 }} position={imagePos?.['image3']} />

      {/* 固定骨架标签词（硬编码 furniture，不进契约） */}
      {label(436, 793, 'when')}
      {label(595, 793, 'where')}
      {label(436, 818, 'who')}
      {label(595, 818, 'what')}

      {/* 主标题（title 槽，全大写） */}
      <Text style={{ position: 'absolute', left: 436, top: 843, width: 320, fontFamily: titleFont, fontSize: 18, lineHeight: 1.0, color: INK, textTransform: 'uppercase' }}>{d['title']}</Text>
    </PdfPageShell>
  );
}
