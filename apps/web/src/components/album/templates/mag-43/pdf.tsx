import { Text, View } from '@react-pdf/renderer';
import { PAGE, PDF_FONTS } from '../constants';
import { PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';

// 拼贴大字内页（PDF 端，与 index.tsx 同一版面 / 同一坐标）。来自 A4-15 (node 11:521)。
// 白底覆盖 Shell 暖纸色；上半部 3 图拼贴 + 图注段落，下半部「Notes / from Elsewhere」大字标题，
// 底部左右两张方图。文字含中文切到 serifCn(Noto SC)，纯英文走 interEn(Inter，与 web 一致)。
// 全套文字 #1c1b18。

const INK = '#1c1b18';
const hasCjk = (s: string | undefined) => /[一-鿿]/.test(s || '');

export function PdfMag43({ data, imagePos }: TemplateRenderProps) {
  const d = data as Record<string, string>;
  const titleFont = hasCjk(d['title']) ? PDF_FONTS.serifCn : PDF_FONTS.interEn;
  const subtitleFont = hasCjk(d['subtitle']) ? PDF_FONTS.serifCn : PDF_FONTS.interEn;
  const captionFont = hasCjk(d['caption']) ? PDF_FONTS.serifCn : PDF_FONTS.interEn;
  return (
    <PdfPageShell>
      {/* 纯白底（覆盖 Shell 暖纸色） */}
      <View style={{ position: 'absolute', left: 0, top: 0, width: PAGE.width, height: PAGE.height, backgroundColor: '#FFFFFF' }} />

      {/* 上半部拼贴：右大竖图 + 左中两竖图 */}
      <PdfImage src={d['image1']} style={{ position: 'absolute', left: 438, top: 28, width: 328, height: 431 }} position={imagePos?.['image1']} />
      <PdfImage src={d['image2']} style={{ position: 'absolute', left: 221, top: 28, width: 195, height: 271 }} position={imagePos?.['image2']} />
      <PdfImage src={d['image3']} style={{ position: 'absolute', left: 40, top: 291, width: 181, height: 268 }} position={imagePos?.['image3']} />

      {/* 右上拼贴下方图注段落 */}
      <Text style={{ position: 'absolute', left: 444, top: 466, width: 334, fontFamily: captionFont, fontSize: 19, lineHeight: 1.4, color: INK }}>{d['caption']}</Text>

      {/* 下半部大字标题（主标题 + 续行） */}
      <Text style={{ position: 'absolute', left: 418, top: 647, width: 360, fontFamily: titleFont, fontWeight: 'bold', fontSize: 88, lineHeight: 1.0, color: INK }}>{d['title']}</Text>
      <Text style={{ position: 'absolute', left: 128, top: 767, width: 650, fontFamily: subtitleFont, fontWeight: 'bold', fontSize: 80, lineHeight: 1.0, color: INK }}>{d['subtitle']}</Text>

      {/* 底部左右两张方图 */}
      <PdfImage src={d['image4']} style={{ position: 'absolute', left: 221, top: 901, width: 181, height: 184 }} position={imagePos?.['image4']} />
      <PdfImage src={d['image5']} style={{ position: 'absolute', left: 584, top: 901, width: 181, height: 184 }} position={imagePos?.['image5']} />
    </PdfPageShell>
  );
}
