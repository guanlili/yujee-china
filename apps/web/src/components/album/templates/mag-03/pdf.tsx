import { Text, View } from '@react-pdf/renderer';
import { COLORS, PDF_FONTS } from '../constants';
import { PdfFolio, PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';
import { resolveThemeCarrier } from '../theme-carrier';

export function PdfMag03({ data, totalPages, imagePos }: TemplateRenderProps) {
  const d = data as {
    label?: string;
    folio?: string;
    image?: string;
  };
  const labelTheme = resolveThemeCarrier(data, 'label');
  return (
    <PdfPageShell fontFamily={PDF_FONTS.sansEn}>
      <PdfImage
        src={d.image}
        style={{ position: 'absolute', top: 80, left: 50, right: 50, height: 925 }}
        position={imagePos?.['image']}
      />
      <View style={{ position: 'absolute', bottom: 50, left: 50, right: 50 }}>
        <Text
          style={{
            letterSpacing: 4,
            color: labelTheme.accentColor ?? COLORS.ink,
            fontSize: 16,
            fontFamily: labelTheme.pdfFontFamily,
          }}
        >
          {labelTheme.text ?? d.label ?? ''}
        </Text>
      </View>
      <PdfFolio folio={d.folio} totalPages={totalPages} fallback="03" />
    </PdfPageShell>
  );
}
