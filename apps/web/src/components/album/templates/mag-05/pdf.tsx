import { Text, View } from '@react-pdf/renderer';
import { COLORS, PDF_FONTS } from '../constants';
import { PdfFolio, PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';
import { resolveThemeCarrier } from '../theme-carrier';

export function PdfMag05({ data, totalPages, imagePos }: TemplateRenderProps) {
  const d = data as {
    title?: string;
    topRight?: string;
    caption?: string;
    folio?: string;
    image?: string;
  };
  const titleTheme = resolveThemeCarrier(data, 'title');
  const topRightTheme = resolveThemeCarrier(data, 'topRight');
  return (
    <PdfPageShell fontFamily={PDF_FONTS.sansEn}>
      <Text
        style={{
          position: 'absolute',
          top: 110,
          left: 50,
          right: 280,
          fontFamily: titleTheme.pdfFontFamily ?? PDF_FONTS.serifEn,
          fontSize: 44,
          lineHeight: 1.15,
          color: titleTheme.accentColor ?? COLORS.ink,
        }}
      >
        {titleTheme.text ?? d.title ?? "LET'S GO RIDE\nA BIKE"}
      </Text>
      <Text
        style={{
          position: 'absolute',
          top: 120,
          right: 50,
          width: 190,
          textAlign: 'right',
          fontSize: 13,
          letterSpacing: 4,
          color: topRightTheme.accentColor ?? COLORS.ink2,
          fontFamily: topRightTheme.pdfFontFamily,
        }}
      >
        {topRightTheme.text ?? d.topRight ?? ''}
      </Text>
      <View style={{ position: 'absolute', top: 290, left: 50, width: 320 }}>
        <Text
          style={{
            lineHeight: 1.75,
            color: COLORS.ink2,
            textAlign: 'justify',
            fontSize: 18,
          }}
        >
          {d.caption || ''}
        </Text>
      </View>
      <PdfImage src={d.image} style={{ position: 'absolute', top: 430, left: 50, right: 50, height: 600 }} position={imagePos?.['image']} />
      <PdfFolio folio={d.folio} totalPages={totalPages} fallback="05" />
    </PdfPageShell>
  );
}
