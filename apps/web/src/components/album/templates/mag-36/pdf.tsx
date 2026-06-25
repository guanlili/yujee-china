import { Text, View } from '@react-pdf/renderer';
import { PAGE, PDF_FONTS } from '../constants';
import { PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';

// 满版大图叠字内页（PDF 端，与 index.tsx 同一版面 / 同一坐标）。来自 A4-8 (node 11:359)。
// 全页白底覆盖 Shell 暖纸色；一张满版背景大图（溢出部分由页面裁掉）；其上居中叠一块
// 半透明白色面板（色块）+ 居中白色大字标题；左下角一行浅色小图注。
// 文字含中文时切到 serifCn（Noto SC）避免豆腐块，纯英文走 interEn（Inter，与 web 一致）。
// 全套深墨文字色 #1c1b18（图注用其 70% 透明），标题为白色叠在面板上。

const hasCjk = (s: string | undefined) => /[一-鿿]/.test(s || '');

export function PdfMag36({ data, imagePos }: TemplateRenderProps) {
  const d = data as Record<string, string>;
  const titleFont = hasCjk(d['title']) ? PDF_FONTS.serifCn : PDF_FONTS.interEn;
  const explainFont = hasCjk(d['explain']) ? PDF_FONTS.serifCn : PDF_FONTS.interEn;
  return (
    <PdfPageShell>
      {/* 纯白底（覆盖 Shell 暖纸色） */}
      <View style={{ position: 'absolute', left: 0, top: 0, width: PAGE.width, height: PAGE.height, backgroundColor: '#FFFFFF' }} />

      {/* 满版背景大图（先渲染，溢出部分被裁；文字 / 面板叠其上） */}
      <PdfImage src={d['image']} style={{ position: 'absolute', left: 0, top: 0, width: 831, height: 1123 }} position={imagePos?.['image']} />

      {/* 居中半透明白色面板（色块，非图片槽） */}
      <View style={{ position: 'absolute', left: 72, top: 436, width: 650, height: 251, backgroundColor: 'rgba(255,255,255,0.55)' }} />

      {/* 居中大字标题（叠在面板上方） */}
      <Text style={{ position: 'absolute', left: 156, top: 520, width: 483, textAlign: 'center', fontFamily: titleFont, fontWeight: 'bold', fontSize: 64, lineHeight: 1.05, color: '#FFFFFF' }}>{d['title']}</Text>

      {/* 左下角浅色小图注 */}
      <Text style={{ position: 'absolute', left: 72, top: 540, width: 320, fontFamily: explainFont, fontSize: 14, lineHeight: 1.4, color: 'rgba(28,27,24,0.7)' }}>{d['explain']}</Text>
    </PdfPageShell>
  );
}
