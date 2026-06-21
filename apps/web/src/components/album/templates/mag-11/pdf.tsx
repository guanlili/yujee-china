import { Text } from '@react-pdf/renderer';
import { COLORS, PDF_FONTS } from '../constants';
import { PdfFolio, PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';
import { resolveThemeCarrier } from '../theme-carrier';

export function PdfMag11({ data, totalPages, imagePos }: TemplateRenderProps) {
  const d = data as {
    image?: string;
    title?: string;
    label?: string;
    explain?: string;
    folio?: string;
  };
  const titleTheme = resolveThemeCarrier(data, 'title');
  const labelTheme = resolveThemeCarrier(data, 'label');
  return (
    <PdfPageShell fontFamily={PDF_FONTS.sansEn}>
      <PdfImage
        src={d.image}
        style={{ position: 'absolute', top: 120, left: 25, right: 25, height: 640 }}
        position={imagePos?.['image']}
      />
      <Text
        style={{
          position: 'absolute',
          top: 800,
          left: 50,
          fontFamily: titleTheme.pdfFontFamily ?? PDF_FONTS.serifEn,
          fontSize: 50,
          letterSpacing: 4,
          lineHeight: 1.1,
          color: titleTheme.accentColor ?? COLORS.ink,
        }}
      >
        {titleTheme.text ?? d.title ?? 'CHERRY\nBUCKET'}
      </Text>
      <Text
        style={{
          position: 'absolute',
          top: 980,
          left: 50,
          width: 260,
          fontSize: 13,
          letterSpacing: 4,
          color: labelTheme.accentColor ?? COLORS.ink,
          fontFamily: labelTheme.pdfFontFamily,
        }}
      >
        {(labelTheme.text ?? d.label ?? '').toUpperCase()}
      </Text>
      <Text
        style={{
          position: 'absolute',
          top: 800,
          right: 50,
          width: 200,
          lineHeight: 1.75,
          color: COLORS.ink2,
          textAlign: 'justify',
          fontSize: 18,
        }}
      >
        {d.explain || ''}
      </Text>
      <PdfFolio folio={d.folio} totalPages={totalPages} fallback="11" />
    </PdfPageShell>
  );
}
