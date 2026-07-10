import { Image, Text, View } from '@react-pdf/renderer';
import { PAGE, PDF_FONTS } from '../constants';
import { PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';
import { YUJEE_LOGO_PNG } from '../brand-logo';
import { resolveThemeCarrier } from '../theme-carrier';

// 封底（PDF 端，与 index.tsx 同一版面 / 同一坐标）。白底覆盖 Shell 暖纸色；
// 主标题 / 署名（lang=user）按有无中文在 Noto Serif SC(中) 与 Playfair(英) 间切换，避免中文豆腐块；
// 结尾文案走 serifCn。竖排署名用 @react-pdf 的 transform rotate(-90deg) 近似 web。品牌落款固定、不进契约。

const INK = '#1c1b18';

export function PdfMag25({ data, imagePos }: TemplateRenderProps) {
  const d = data as Record<string, string>;
  const year = new Date().getFullYear();
  const labelTheme = resolveThemeCarrier(data, 'label', 'decoration');
  const explainTheme = resolveThemeCarrier(data, 'explain', 'explain');
  const dateTheme = resolveThemeCarrier(data, 'date', 'decoration');
  const titleTheme = resolveThemeCarrier(data, 'title', 'title');
  const bodyTheme = resolveThemeCarrier(data, 'body', 'body');
  return (
    <PdfPageShell>
      {/* 纯白底（覆盖 Shell 暖纸色） */}
      <View style={{ position: 'absolute', left: 0, top: 0, width: PAGE.width, height: PAGE.height, backgroundColor: '#FFFFFF' }} />

      {/* 左上大图 */}
      <PdfImage src={d['image1']} style={{ position: 'absolute', left: 0, top: 56, width: 426, height: 636 }} position={imagePos?.['image1']} />

      {/* 左下图 */}
      <PdfImage src={d['image2']} style={{ position: 'absolute', left: 0, top: 692, width: 426, height: 375 }} position={imagePos?.['image2']} />

      {/* 右上：大号装饰数字编号 */}
      <Text style={{ position: 'absolute', left: 613, top: 120, width: 120, fontFamily: labelTheme.pdfFontFamily, fontWeight: 'bold', fontSize: 64, lineHeight: 1, color: labelTheme.accentColor ?? INK }}>{d['label']}</Text>

      {/* 竖排作者署名（rotate -90°，沿右半左缘自下而上） */}
      <View style={{ position: 'absolute', left: 443, top: 250, transform: 'rotate(-90deg)', transformOrigin: 'top left' }}>
        <Text style={{ fontFamily: explainTheme.pdfFontFamily, fontSize: 19, lineHeight: 1, letterSpacing: 0.6, color: explainTheme.accentColor ?? INK }}>{d['explain']}</Text>
      </View>

      {/* 日期 */}
      <Text style={{ position: 'absolute', left: 621, top: 189, width: 90, fontFamily: dateTheme.pdfFontFamily, fontSize: 19, lineHeight: 1, color: dateTheme.accentColor ?? INK }}>{d['date']}</Text>

      {/* 两行主标题 */}
      <Text style={{ position: 'absolute', left: 495, top: 349, width: 160, fontFamily: titleTheme.pdfFontFamily, fontSize: 59, lineHeight: 1.25, color: titleTheme.accentColor ?? INK }}>{d['title']}</Text>

      {/* 结尾文案 */}
      <Text style={{ position: 'absolute', left: 496, top: 592, width: 210, fontFamily: bodyTheme.pdfFontFamily, fontSize: 19, lineHeight: 1.6, color: bodyTheme.accentColor ?? INK }}>{d['body']}</Text>

      {/* ── 固定品牌落款（同 mag-20；右下角） ── */}
      {/* 品牌 logo */}
      <Image src={YUJEE_LOGO_PNG} style={{ position: 'absolute', left: 629, top: 990, width: 112, height: 47, objectFit: 'contain' }} />
      {/* 版权 */}
      <Text style={{ position: 'absolute', left: 629, top: 1047, width: 130, fontFamily: PDF_FONTS.interEn, fontSize: 16, color: '#C2C2C2' }}>© {year} Yujee</Text>
    </PdfPageShell>
  );
}
