import { Text } from '@react-pdf/renderer';
import { COLORS, PDF_FONTS } from '../constants';
import { PdfFolio, PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';
import { resolveThemeCarrier } from '../theme-carrier';


export function PdfMag15({ data, totalPages, imagePos }: TemplateRenderProps) {
  const d = data as {
    image1?: string;
    image2?: string;
    body?: string;
    title?: string;
    date?: string;
    folio?: string;
  };
  const titleTheme = resolveThemeCarrier(data, 'title', 'title');
  const dateTheme = resolveThemeCarrier(data, 'date', 'decoration');
  const titleText = titleTheme.text ?? d.title ?? 'HAPPY\nCHOFU';
  const bodyTheme = resolveThemeCarrier(data, 'body', 'body');
  const folioTheme = resolveThemeCarrier(data, 'folio', 'decoration');
  return (
    <PdfPageShell fontFamily={PDF_FONTS.sansEn}>
      <Text
        style={{
          position: 'absolute',
          top: 90,
          left: 70,
          width: 280,
          lineHeight: 1.7,
          fontFamily: bodyTheme.pdfFontFamily,
          color: bodyTheme.accentColor ?? COLORS.ink2,
          textAlign: 'justify',
          fontSize: 18,
        }}
      >
        {d.body || ''}
      </Text>
      <PdfImage
        src={d.image1}
        style={{ position: 'absolute', top: 180, right: 70, width: 655, height: 440 }}
        position={imagePos?.['image1']}
      />
      <PdfImage
        src={d.image2}
        style={{ position: 'absolute', top: 660, left: 70, width: 400, height: 350 }}
        position={imagePos?.['image2']}
      />
      <Text
        style={{
          position: 'absolute',
          top: 690,
          right: 70,
          width: 460,
          textAlign: 'right',
          fontFamily: titleTheme.pdfFontFamily,
          fontWeight: 'bold',
          fontSize: 84,
          letterSpacing: 1,
          lineHeight: 1.02,
          color: titleTheme.accentColor ?? COLORS.ink,
        }}
      >
        {titleText}
      </Text>
      <Text
        style={{
          position: 'absolute',
          bottom: 95,
          right: 72,
          fontSize: 11,
          letterSpacing: 4,
          color: dateTheme.accentColor ?? COLORS.ink2,
          fontFamily: dateTheme.pdfFontFamily,
        }}
      >
        {(dateTheme.text ?? d.date ?? '').toUpperCase()}
      </Text>
      <PdfFolio fontFamily={folioTheme.pdfFontFamily} folio={d.folio} totalPages={totalPages} accentColor={folioTheme.accentColor} fallback="15" />
    </PdfPageShell>
  );
}
