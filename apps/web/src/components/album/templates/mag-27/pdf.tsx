import { Text, View } from '@react-pdf/renderer';
import { PAGE, PDF_FONTS } from '../constants';
import { PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';
import { resolveThemeCarrier } from '../theme-carrier';

// 杂志风内页（PDF 端，与 index.tsx 同一版面 / 同一坐标）。白底覆盖 Shell 暖纸色；
// title 为 lang=user，按内容有无中文在 montserrat(英) 与 sansCn(中) 间切换，避免中文豆腐块；
// 其余 user 文案走 sansCn（中英通吃）。左上角汉堡图标固定、不进契约。
// 字体顶替：Audiowide → montserrat；PingFang SC → sansCn。

const INK = '#1c1b18';
const HAMBURGER = '#656565';
const hasCjk = (s: string | undefined) => /[一-鿿]/.test(s || '');

export function PdfMag27({ data, imagePos }: TemplateRenderProps) {
  const d = data as Record<string, string>;
  const titleFont = hasCjk(d['title']) ? PDF_FONTS.sansCn : PDF_FONTS.montserrat;
  const titleTheme = resolveThemeCarrier(data, 'title');
  const explain1Theme = resolveThemeCarrier(data, 'explain1');
  const bodyTheme = resolveThemeCarrier(data, 'body');
  const dateTheme = resolveThemeCarrier(data, 'date');
  const explain2Theme = resolveThemeCarrier(data, 'explain2');
  const label1Theme = resolveThemeCarrier(data, 'label1');
  const label2Theme = resolveThemeCarrier(data, 'label2');
  return (
    <PdfPageShell>
      {/* 纯白底（覆盖 Shell 暖纸色） */}
      <View style={{ position: 'absolute', left: 0, top: 0, width: PAGE.width, height: PAGE.height, backgroundColor: '#FFFFFF' }} />

      {/* 左上角固定汉堡图标（两根横条，furniture） */}
      <View style={{ position: 'absolute', left: 63, top: 59, width: 23, height: 3, backgroundColor: HAMBURGER }} />
      <View style={{ position: 'absolute', left: 63, top: 65, width: 23, height: 3, backgroundColor: HAMBURGER }} />

      {/* 左上大标题（宽体展示字，两行） */}
      <Text style={{ position: 'absolute', left: 63, top: 116, width: 335, fontFamily: titleFont, fontWeight: 'bold', fontSize: 75, lineHeight: 1.1, letterSpacing: 3, color: titleTheme.accentColor ?? INK }}>{d['title']}</Text>

      {/* 右上小标题 / 导语 */}
      <Text style={{ position: 'absolute', left: 430, top: 108, width: 144, fontFamily: PDF_FONTS.sansCn, fontWeight: 'medium', fontSize: 21, lineHeight: 1.3, color: explain1Theme.accentColor ?? INK }}>{d['explain1']}</Text>

      {/* 右上正文导语 */}
      <Text style={{ position: 'absolute', left: 430, top: 212, width: 310, fontFamily: PDF_FONTS.sansCn, fontSize: 19, lineHeight: 1.4, color: bodyTheme.accentColor ?? INK }}>{d['body']}</Text>

      {/* 中部横图 */}
      <PdfImage src={d['image']} style={{ position: 'absolute', left: 55, top: 353, width: 685, height: 476 }} position={imagePos?.['image']} />

      {/* 日期 */}
      <Text style={{ position: 'absolute', left: 55, top: 840, fontFamily: PDF_FONTS.sansCn, fontSize: 19, color: dateTheme.accentColor ?? INK }}>{d['date']}</Text>

      {/* 图注 */}
      <Text style={{ position: 'absolute', left: 55, top: 878, width: 232, fontFamily: PDF_FONTS.sansCn, fontSize: 19, lineHeight: 1.3, color: explain2Theme.accentColor ?? INK }}>{d['explain2']}</Text>

      {/* 右侧标签 */}
      <Text style={{ position: 'absolute', left: 698, top: 834, fontFamily: PDF_FONTS.sansCn, fontSize: 19, color: label1Theme.accentColor ?? INK }}>{d['label1']}</Text>

      {/* 底部页脚小字 */}
      <Text style={{ position: 'absolute', left: 316, top: 996, fontFamily: PDF_FONTS.sansCn, fontSize: 16, color: label2Theme.accentColor ?? INK }}>{d['label2']}</Text>
    </PdfPageShell>
  );
}
