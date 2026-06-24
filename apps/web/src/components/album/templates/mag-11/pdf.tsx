import { Text } from '@react-pdf/renderer';
import { COLORS, PDF_FONTS } from '../constants';
import { PdfFolio, PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';
import { resolveThemeCarrier } from '../theme-carrier';

const hasCjk = (s: string | undefined) => /[一-鿿]/.test(s || '');

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
  const titleText = titleTheme.text ?? d.title ?? 'CHERRY\nBUCKET';
  const titleFont = titleTheme.pdfFontFamily ?? (hasCjk(titleText) ? PDF_FONTS.serifCn : PDF_FONTS.playfair);
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
          top: 792,
          left: 50,
          width: 360,
          fontFamily: titleFont,
          fontWeight: 'bold',
          fontSize: 76,
          letterSpacing: 0.8,
          lineHeight: 1.02,
          color: titleTheme.accentColor ?? COLORS.ink,
        }}
      >
        {titleText}
      </Text>
      <Text
        style={{
          position: 'absolute',
          top: 992,
          left: 50,
          width: 280,
          fontSize: 13,
          letterSpacing: 4,
          color: labelTheme.accentColor ?? COLORS.ink,
          fontFamily: labelTheme.pdfFontFamily ?? PDF_FONTS.montserrat,
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
