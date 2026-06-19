import { Text, View } from '@react-pdf/renderer';
import { COLORS, PDF_FONTS } from '../constants';
import { PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';
import { resolveThemeCarrier } from '../theme-carrier';

export function PdfMag13({ data, imagePos }: TemplateRenderProps) {
  const d = data as {
    image?: string;
    title?: string;
    divider?: string;
    caption?: string;
    folio?: string;
  };
  const titleTheme = resolveThemeCarrier(data, 'title');
  return (
    <PdfPageShell fontFamily={PDF_FONTS.sansEn}>
      <Text
        style={{
          position: 'absolute',
          top: 110,
          left: 90,
          right: 90,
          fontFamily: titleTheme.pdfFontFamily ?? PDF_FONTS.serifEn,
          fontSize: 28,
          letterSpacing: 8,
          textAlign: 'center',
          lineHeight: 1.35,
          color: titleTheme.accentColor ?? COLORS.ink,
        }}
      >
        {titleTheme.text ?? d.title ?? 'YUICHI TOKUDA\nPHOTOGRAPHY'}
      </Text>
      <View
        style={{
          position: 'absolute',
          top: 242,
          left: 260,
          right: 260,
          height: 2,
          backgroundColor: d.divider || COLORS.ink2,
        }}
      />
      <PdfImage
        src={d.image}
        style={{ position: 'absolute', top: 300, left: 90, right: 90, height: 520 }}
        position={imagePos?.['image']}
      />
      <Text
        style={{
          position: 'absolute',
          top: 855,
          left: 130,
          right: 130,
          textAlign: 'center',
          lineHeight: 1.75,
          color: COLORS.ink2,
          fontSize: 15,
        }}
      >
        {d.caption || ''}
      </Text>
    </PdfPageShell>
  );
}
