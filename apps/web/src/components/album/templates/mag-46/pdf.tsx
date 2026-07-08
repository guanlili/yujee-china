import { Text, View } from '@react-pdf/renderer';
import { PAGE, PDF_FONTS } from '../constants';
import { PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';
import { resolveThemeCarrier } from '../theme-carrier';

// 拼贴对角双图叠标签骨架内页（PDF 端，与 index.tsx 同一版面 / 同一坐标）。来自 A4-18 (node 12:65)。
// 白底覆盖 Shell 暖纸色；顶部陶土红大字主标题，下面 when/where/who/what 固定骨架标签词
// （硬编码 furniture，非契约槽）。左侧竖图，右下角小竖图叠角，右侧小图注承接标题。
// 文字含中文时切到 serifCn（Noto SC）避免豆腐块，纯英文走 interEn（Inter，与 web 一致）。
// 全套文字陶土红 #1c1b18。

const INK = '#1c1b18';
const hasCjk = (s: string | undefined) => /[一-鿿]/.test(s || '');

export function PdfMag46({ data, imagePos }: TemplateRenderProps) {
  const d = data as Record<string, string>;
  const titleFont = hasCjk(d['title']) ? PDF_FONTS.serifCn : PDF_FONTS.interEn;
  const captionFont = hasCjk(d['caption']) ? PDF_FONTS.serifCn : PDF_FONTS.interEn;
  const titleTheme = resolveThemeCarrier(data, 'title');
  const captionTheme = resolveThemeCarrier(data, 'caption');
  return (
    <PdfPageShell>
      {/* 纯白底（覆盖 Shell 暖纸色） */}
      <View style={{ position: 'absolute', left: 0, top: 0, width: PAGE.width, height: PAGE.height, backgroundColor: '#FFFFFF' }} />

      {/* 顶部大字主标题 */}
      <Text style={{ position: 'absolute', left: 91, top: 65, width: 480, fontFamily: titleFont, fontWeight: 'bold', fontSize: 36, lineHeight: 1.1, color: titleTheme.accentColor ?? INK }}>{d['title']}</Text>

      {/* 固定骨架标签词 furniture：when / where / who / what（硬编码，不做槽） */}
      <Text style={{ position: 'absolute', left: 91, top: 128, fontFamily: PDF_FONTS.interEn, fontWeight: 'bold', fontSize: 16, lineHeight: 1.2, color: INK }}>when</Text>
      <Text style={{ position: 'absolute', left: 231, top: 128, fontFamily: PDF_FONTS.interEn, fontWeight: 'bold', fontSize: 16, lineHeight: 1.2, color: INK }}>where</Text>
      <Text style={{ position: 'absolute', left: 91, top: 153, fontFamily: PDF_FONTS.interEn, fontWeight: 'bold', fontSize: 16, lineHeight: 1.2, color: INK }}>who</Text>
      <Text style={{ position: 'absolute', left: 231, top: 153, fontFamily: PDF_FONTS.interEn, fontWeight: 'bold', fontSize: 16, lineHeight: 1.2, color: INK }}>what</Text>

      {/* 右侧小图注（承接标题） */}
      <Text style={{ position: 'absolute', left: 231, top: 299, width: 334, fontFamily: captionFont, fontSize: 16, lineHeight: 1.35, color: captionTheme.accentColor ?? INK }}>{d['caption']}</Text>

      {/* 左侧竖图（先渲染） */}
      <PdfImage src={d['image1']} style={{ position: 'absolute', left: 91, top: 331, width: 467, height: 730 }} position={imagePos?.['image1']} />

      {/* 右下角小竖图（叠在左图右下角之上） */}
      <PdfImage src={d['image2']} style={{ position: 'absolute', left: 478, top: 761, width: 226, height: 300 }} position={imagePos?.['image2']} />
    </PdfPageShell>
  );
}
