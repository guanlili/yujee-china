import { Text, View } from '@react-pdf/renderer';
import { PAGE, PDF_FONTS } from '../constants';
import { PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';
import { resolveThemeCarrier } from '../theme-carrier';

// 跨页大图叠字右半页（PDF 端，与 index.tsx 同一版面 / 同一坐标）。来自 A4-7 跨页
// (node 11:271) 右半页（x 减 595）。白底覆盖 Shell 暖纸色；跨页大图右片段铺整页，
// 跨页大标题右片段为下缘大展示字（负 left 由裁切呈现右片段）。
// 标题含中文时切到 serifCn（Noto SC）避免豆腐块，纯英文走 interEn（Inter，与 web 一致）。
// 全套文字陶土黑 #1c1b18。

const INK = '#1c1b18';
const hasCjk = (s: string | undefined) => /[一-鿿]/.test(s || '');

export function PdfMag53({ data, imagePos }: TemplateRenderProps) {
  const d = data as Record<string, string>;
  const title = d['title'] || 'Notes from Elsewhere';
  const titleFont = hasCjk(title) ? PDF_FONTS.serifCn : PDF_FONTS.interEn;
  const titleTheme = resolveThemeCarrier(data, 'title');
  return (
    <PdfPageShell>
      {/* 纯白底（覆盖 Shell 暖纸色） */}
      <View style={{ position: 'absolute', left: 0, top: 0, width: PAGE.width, height: PAGE.height, backgroundColor: '#FFFFFF' }} />

      {/* 跨页大图右片段（槽 image，11:311；负 left 由 PdfPageShell 裁切左溢出） */}
      <PdfImage src={d['image']} style={{ position: 'absolute', left: -180, top: 61, width: 907, height: 1001 }} position={imagePos?.['image']} />

      {/* 跨页大标题右片段（槽 title，11:327；负 left 显示右片段大展示字） */}
      <Text style={{ position: 'absolute', left: -180, top: 823, width: 1265, height: 346, fontFamily: titleFont, fontSize: 120, lineHeight: 1.05, color: titleTheme.accentColor ?? INK }}>{title}</Text>
    </PdfPageShell>
  );
}
