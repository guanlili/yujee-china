import { Text, View } from '@react-pdf/renderer';
import { COLORS, PDF_FONTS } from '../constants';
import { PdfFolio, PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';

export function PdfMag03({ data, totalPages }: TemplateRenderProps) {
  const d = data as {
    location?: string;
    folio?: string;
    image?: string;
  };
  return (
    <PdfPageShell fontFamily={PDF_FONTS.sansEn}>
      <PdfImage
        src={d.image}
        style={{ position: 'absolute', top: 80, left: 50, right: 50, height: 925 }}
      />
      <View style={{ position: 'absolute', bottom: 50, left: 50, right: 50 }}>
        <Text style={{ letterSpacing: 4, color: COLORS.ink, fontSize: 16 }}>
          {d.location || ''}
        </Text>
      </View>
      <PdfFolio folio={d.folio} totalPages={totalPages} fallback="03" />
    </PdfPageShell>
  );
}
