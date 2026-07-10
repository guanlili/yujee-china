import { Text, View } from '@react-pdf/renderer';
import { COLORS, PDF_FONTS } from '../constants';
import { PdfFolio, PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';
import { resolveThemeCarrier } from '../theme-carrier';

// @react-pdf 无逐字回退：标签默认 Montserrat（与 web 一致），含中文则切 serifCn(Noto SC) 避免豆腐块。

export function PdfMag03({ data, totalPages, imagePos }: TemplateRenderProps) {
  const d = data as {
    label?: string;
    date?: string;
    folio?: string;
    image?: string;
  };
  const labelTheme = resolveThemeCarrier(data, 'label', 'decoration');
  const dateTheme = resolveThemeCarrier(data, 'date', 'decoration');
  const folioTheme = resolveThemeCarrier(data, 'folio', 'decoration');
  const labelText = labelTheme.text ?? d.label ?? '';
  const dateText = d.date ?? '';
  // 装饰：与标签同色（参与主题换肤）的四角框线，压在图片之上（与 web 一致）。
  const decorColor = labelTheme.accentColor ?? COLORS.ink;
  const corners = [
    { top: 94, left: 64, sides: ['Top', 'Left'] },
    { top: 94, left: 702, sides: ['Top', 'Right'] },
    { top: 963, left: 64, sides: ['Bottom', 'Left'] },
    { top: 963, left: 702, sides: ['Bottom', 'Right'] },
  ] as const;
  return (
    <PdfPageShell fontFamily={PDF_FONTS.sansEn}>
      <PdfImage
        src={d.image}
        style={{ position: 'absolute', top: 80, left: 50, right: 50, height: 925 }}
        position={imagePos?.['image']}
      />
      {corners.map((c, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            top: c.top,
            left: c.left,
            width: 30,
            height: 30,
            ...Object.fromEntries(
              c.sides.flatMap((s) => [
                [`border${s}Width`, 2],
                [`border${s}Color`, decorColor],
              ]),
            ),
          }}
        />
      ))}
      <View style={{ position: 'absolute', bottom: 50, left: 50, right: 50 }}>
        <Text
          style={{
            // 小标签(京都 ·):字号砍半(30→15),日期上方的小字 kicker,与 web 一致(中文回退 serifCn)。
            letterSpacing: 5,
            color: labelTheme.accentColor ?? COLORS.ink,
            textTransform: 'uppercase',
            fontSize: 15,
            fontWeight: 600,
            fontFamily: labelTheme.pdfFontFamily,
          }}
        >
          {labelText}
        </Text>
        {dateText ? (
          <Text
            style={{
              // 日期(03 / 30):字号 30,下方较大的一部分,与 web 一致。
              marginTop: 6,
              letterSpacing: 2,
              color: dateTheme.accentColor ?? labelTheme.accentColor ?? COLORS.ink,
              fontSize: 30,
              fontWeight: 600,
              fontFamily: dateTheme.pdfFontFamily,
            }}
          >
            {dateText}
          </Text>
        ) : null}
      </View>
      <PdfFolio fontFamily={folioTheme.pdfFontFamily} folio={d.folio} totalPages={totalPages} accentColor={folioTheme.accentColor} fallback="03" />
    </PdfPageShell>
  );
}
