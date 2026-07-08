import { Circle, Image, Path, Rect, Svg, Text, View } from '@react-pdf/renderer';
import { PAGE, PDF_FONTS } from '../constants';
import { PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';
import { YUJEE_LOGO_PNG } from '../brand-logo';
import { resolveThemeCarrier } from '../theme-carrier';

// 故事合集内页（PDF 端，与 index.tsx 同一版面 / 同一坐标）。白底覆盖 Shell 暖纸色；
// 标题 / 署名按内容有无中文在 Playfair(英) 与 Noto Serif SC(中) 间切换，避免中文豆腐块；
// 正文走 serifCn（中英通吃）。品牌落款固定、不进契约。

const BRAND_INK = '#292929';
const INK = '#1c1b18';
const hasCjk = (s: string | undefined) => /[一-鿿]/.test(s || '');

export function PdfMag22({ data, imagePos }: TemplateRenderProps) {
  const d = data as Record<string, string>;
  const year = new Date().getFullYear();
  const titleFont = hasCjk(d['title']) ? PDF_FONTS.serifCn : PDF_FONTS.playfair;
  const name1Font = hasCjk(d['explain1']) ? PDF_FONTS.serifCn : PDF_FONTS.playfair;
  const name2Font = hasCjk(d['explain2']) ? PDF_FONTS.serifCn : PDF_FONTS.playfair;
  const titleTheme = resolveThemeCarrier(data, 'title');
  const body1Theme = resolveThemeCarrier(data, 'body1');
  const explain1Theme = resolveThemeCarrier(data, 'explain1');
  const body2Theme = resolveThemeCarrier(data, 'body2');
  const explain2Theme = resolveThemeCarrier(data, 'explain2');
  return (
    <PdfPageShell>
      {/* 纯白底（覆盖 Shell 暖纸色） */}
      <View style={{ position: 'absolute', left: 0, top: 0, width: PAGE.width, height: PAGE.height, backgroundColor: '#FFFFFF' }} />

      {/* 合集主标题 */}
      <Text style={{ position: 'absolute', left: 271, top: 95, width: 480, fontFamily: titleFont, fontWeight: 'bold', fontSize: 60, lineHeight: 1.1, color: titleTheme.accentColor ?? INK }}>{d['title']}</Text>

      {/* 故事一：图 + 正文 + 署名 */}
      <PdfImage src={d['image1']} style={{ position: 'absolute', left: 72, top: 272, width: 240, height: 249 }} position={imagePos?.['image1']} />
      <Text style={{ position: 'absolute', left: 354, top: 296, width: 314, fontFamily: PDF_FONTS.serifCn, fontSize: 18, lineHeight: 1.6, color: body1Theme.accentColor ?? INK }}>{d['body1']}</Text>
      <Text style={{ position: 'absolute', left: 352, top: 478, width: 304, fontFamily: name1Font, fontWeight: 'bold', fontSize: 24, color: explain1Theme.accentColor ?? INK }}>{d['explain1']}</Text>

      {/* 故事二：图 + 正文 + 署名 */}
      <PdfImage src={d['image2']} style={{ position: 'absolute', left: 72, top: 536, width: 240, height: 244 }} position={imagePos?.['image2']} />
      <Text style={{ position: 'absolute', left: 351, top: 558, width: 314, fontFamily: PDF_FONTS.serifCn, fontSize: 18, lineHeight: 1.6, color: body2Theme.accentColor ?? INK }}>{d['body2']}</Text>
      <Text style={{ position: 'absolute', left: 354, top: 738, width: 304, fontFamily: name2Font, fontWeight: 'bold', fontSize: 24, color: explain2Theme.accentColor ?? INK }}>{d['explain2']}</Text>

      {/* ── 固定品牌落款（同 mag-20） ── */}
      {/* 左下角：品牌 logo */}
      <Image src={YUJEE_LOGO_PNG} style={{ position: 'absolute', left: 56, top: 979, width: 112, height: 47, objectFit: 'contain' }} />
      {/* 左下角：版权 */}
      <Text style={{ position: 'absolute', left: 56, top: 1038, width: 140, fontFamily: PDF_FONTS.interEn, fontSize: 16, color: '#C2C2C2' }}>©  {year} Yujee</Text>
      {/* 右下角：Instagram 图标（描边） */}
      <Svg viewBox="0 0 24 24" style={{ position: 'absolute', left: 646, top: 992, width: 32, height: 32 }}>
        <Rect x="2.5" y="2.5" width="19" height="19" rx="5.2" stroke={BRAND_INK} strokeWidth={1.8} fill="none" />
        <Circle cx="12" cy="12" r="4.2" stroke={BRAND_INK} strokeWidth={1.8} fill="none" />
        <Circle cx="17.5" cy="6.5" r="1.15" fill={BRAND_INK} />
      </Svg>
      {/* 右下角：X 图标 */}
      <Svg viewBox="0 0 24 24" style={{ position: 'absolute', left: 699, top: 992, width: 32, height: 32 }}>
        <Path d="M18.244 2H21.5L14 10.57L23 22H16.17L11.15 15.44L5.4 22H2.14L10.16 12.83L1.5 2H8.49L13.03 8L18.24 2H18.244ZM17.044 20H18.854L7.04 3.88H5.1L17.044 20Z" fill={BRAND_INK} />
      </Svg>
    </PdfPageShell>
  );
}
