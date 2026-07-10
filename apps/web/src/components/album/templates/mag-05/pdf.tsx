import { Text, View } from '@react-pdf/renderer';
import { COLORS, PDF_FONTS } from '../constants';
import { PdfFolio, PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';
import { resolveThemeCarrier } from '../theme-carrier';


export function PdfMag05({ data, totalPages, imagePos }: TemplateRenderProps) {
  const d = data as {
    title?: string;
    label?: string;
    explain?: string;
    folio?: string;
    image?: string;
  };
  const titleTheme = resolveThemeCarrier(data, 'title', 'title');
  const topRightTheme = resolveThemeCarrier(data, 'label', 'decoration');
  const explainTheme = resolveThemeCarrier(data, 'explain', 'explain');
  const folioTheme = resolveThemeCarrier(data, 'folio', 'decoration');
  const titleText = titleTheme.text ?? d.title ?? "LET'S GO RIDE\nA BIKE";
  return (
    <PdfPageShell fontFamily={PDF_FONTS.sansEn}>
      <Text
        style={{
          position: 'absolute',
          top: 96,
          left: 50,
          right: 240,
          fontFamily: titleTheme.pdfFontFamily,
          fontSize: 88,
          letterSpacing: 1.5,
          lineHeight: 0.92,
          color: titleTheme.accentColor ?? COLORS.ink,
        }}
      >
        {titleText.toUpperCase()}
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
        {(topRightTheme.text ?? d.label ?? '').toUpperCase()}
      </Text>
      <View style={{ position: 'absolute', top: 290, left: 50, width: 320 }}>
        <Text
          style={{
            lineHeight: 1.75,
            fontFamily: explainTheme.pdfFontFamily,
            color: explainTheme.accentColor ?? COLORS.ink2,
            textAlign: 'justify',
            fontSize: 18,
          }}
        >
          {d.explain || ''}
        </Text>
      </View>
      <PdfImage src={d.image} style={{ position: 'absolute', top: 430, left: 50, right: 50, height: 600 }} position={imagePos?.['image']} />
      <PdfFolio fontFamily={folioTheme.pdfFontFamily} folio={d.folio} totalPages={totalPages} accentColor={folioTheme.accentColor} fallback="05" />
    </PdfPageShell>
  );
}
