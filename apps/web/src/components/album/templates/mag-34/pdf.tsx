import { Text, View } from '@react-pdf/renderer';
import { PAGE, PDF_FONTS } from '../constants';
import { PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';
import { resolveThemeCarrier } from '../theme-carrier';

// 居中竖图 + 上下居中文字内页（PDF 端，与 index.tsx 同一版面 / 同一坐标）。来自 A4-5 (node 10:115)。
// 白底覆盖 Shell 暖纸色；中央竖图，顶部居中大字主标题，底部居中图注。
// 文字含中文时切到 serifCn（Noto SC）避免豆腐块，纯英文走 interEn（Inter，与 web 一致）。
// 全套文字墨色 #1c1b18。
const INK = '#1c1b18';
const hasCjk = (s: string | undefined) => /[一-鿿]/.test(s || '');

export function PdfMag34({ data, imagePos }: TemplateRenderProps) {
  const d = data as Record<string, string>;
  const titleFont = hasCjk(d['title']) ? PDF_FONTS.serifCn : PDF_FONTS.interEn;
  const explainFont = hasCjk(d['explain']) ? PDF_FONTS.serifCn : PDF_FONTS.interEn;
  const titleTheme = resolveThemeCarrier(data, 'title');
  const explainTheme = resolveThemeCarrier(data, 'explain');
  return (
    <PdfPageShell>
      {/* 纯白底（覆盖 Shell 暖纸色） */}
      <View style={{ position: 'absolute', left: 0, top: 0, width: PAGE.width, height: PAGE.height, backgroundColor: '#FFFFFF' }} />

      {/* 中央竖图（先渲染，文字叠其上） */}
      <PdfImage src={d['image']} style={{ position: 'absolute', left: 163, top: 234, width: 470, height: 737 }} position={imagePos?.['image']} />

      {/* 顶部居中大字主标题（压在图上沿） */}
      <Text style={{ position: 'absolute', left: 35, top: 187, width: 726, fontFamily: titleFont, fontWeight: 'bold', fontSize: 56, lineHeight: 1.05, color: titleTheme.accentColor ?? INK, textAlign: 'center' }}>{d['title']}</Text>

      {/* 底部居中图注 */}
      <Text style={{ position: 'absolute', left: 44, top: 970, width: 707, fontFamily: explainFont, fontSize: 21, lineHeight: 1.35, color: explainTheme.accentColor ?? INK, textAlign: 'center' }}>{d['explain']}</Text>
    </PdfPageShell>
  );
}
