import { Text, View } from '@react-pdf/renderer';
import { COLORS, PDF_FONTS } from '../constants';
import { PdfFolio, PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';
import { resolveThemeCarrier } from '../theme-carrier';

export function PdfMag07({ data, totalPages, imagePos }: TemplateRenderProps) {
  const d = data as {
    image1?: string;
    image2?: string;
    explain1?: string;
    explain2?: string;
    title?: string;
    folio?: string;
  };
  const titleTheme = resolveThemeCarrier(data, 'title', 'title');
  const explain1Theme = resolveThemeCarrier(data, 'explain1', 'explain');
  const explain2Theme = resolveThemeCarrier(data, 'explain2', 'explain');
  const folioTheme = resolveThemeCarrier(data, 'folio', 'decoration');
  const titleText = titleTheme.text ?? d.title ?? 'FUSHI\nINARI';
  // ── 各槽位几何（与 index.tsx 保持一致；直接改这里的数字）──
  // 坐标系：整页 794×1123 px，左上角 (0,0)，单位 px。
  const LAYOUT = {
    caption1: { x: 50, y: 150, w: 240, h: 330, fontSize: 18 }, // 文本框1（上）：x/y 位置、h 高度、fontSize 字号均可编辑
    caption2: { x: 50, y: 510, w: 240, h: 420, fontSize: 18 }, // 文本框2（下，对齐大图）：x/y 位置、h 高度、fontSize 字号均可编辑
    title: { x: 50, bottom: 70, fontSize: 104 }, // 标题（贴底；bottom 越大越往上）展示级 Bebas Neue 大字
    image1: { x: 364, y: 90, w: 380, h: 330 }, // 上方横图
    image2: { x: 364, y: 450, w: 380, h: 480 }, // 下方竖图（大）
  };
  const cap = (text: string, fontSize: number, fontFamily?: string, color?: string) => (
    <Text style={{ fontFamily, lineHeight: 1.7, color: color ?? COLORS.ink2, textAlign: 'justify', fontSize }}>
      {text}
    </Text>
  );
  return (
    <PdfPageShell fontFamily={PDF_FONTS.sansEn}>
      <View
        style={{
          position: 'absolute',
          top: LAYOUT.caption1.y,
          left: LAYOUT.caption1.x,
          width: LAYOUT.caption1.w,
          height: LAYOUT.caption1.h,
        }}
      >
        {cap(
          d.explain1 || '',
          LAYOUT.caption1.fontSize,
          explain1Theme.pdfFontFamily,
          explain1Theme.accentColor ?? undefined,
        )}
      </View>
      <PdfImage
        src={d.image1}
        style={{ position: 'absolute', left: 364, top: 60, width: 380, height: 330 }}
        position={imagePos?.['image1']}
      />
      <View
        style={{
          position: 'absolute',
          top: LAYOUT.caption2.y,
          left: LAYOUT.caption2.x,
          width: LAYOUT.caption2.w,
          height: LAYOUT.caption2.h,
        }}
      >
        {cap(
          d.explain2 || '',
          LAYOUT.caption2.fontSize,
          explain2Theme.pdfFontFamily,
          explain2Theme.accentColor ?? undefined,
        )}
      </View>
      <PdfImage
        src={d.image2}
        style={{ position: 'absolute', left: 364, top: 450, width: 380, height: 480 }}
        position={imagePos?.['image2']}
      />
      <Text
        style={{ position: 'absolute', left: 50, bottom: LAYOUT.title.bottom, width: 300, fontFamily: titleTheme.pdfFontFamily,
          fontSize: LAYOUT.title.fontSize,
          letterSpacing: 1,
          lineHeight: 0.92,
          color: titleTheme.accentColor ?? COLORS.ink }}
      >
        {titleText}
      </Text>
      <PdfFolio fontFamily={folioTheme.pdfFontFamily} folio={d.folio} totalPages={totalPages} accentColor={folioTheme.accentColor} fallback="07" />
    </PdfPageShell>
  );
}
