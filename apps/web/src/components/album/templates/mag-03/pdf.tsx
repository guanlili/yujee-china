import { Text, View } from '@react-pdf/renderer';
import { COLORS, PDF_FONTS } from '../constants';
import { PdfFolio, PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';

export function PdfMag03({ data, totalPages }: TemplateRenderProps) {
  const d = data as {
    category?: string;
    location?: string;
    caption?: string;
    folio?: string;
    image?: string;
  };
  return (
    <PdfPageShell fontFamily={PDF_FONTS.sansEn}>
      <View
        style={{
          position: 'absolute',
          top: 60,
          left: 50,
          right: 50,
          flexDirection: 'row',
          justifyContent: 'space-between',
        }}
      >
        <Text style={{ fontWeight: 500, fontFamily: PDF_FONTS.sansCn, fontSize: 16, color: COLORS.ink2 }}>
          {d.category || 'Portrait'}
        </Text>
      </View>
      <PdfImage
        src={d.image}
        style={{ position: 'absolute', top: 100, left: 50, right: 50, bottom: 130 }}
      />
      <View style={{ position: 'absolute', bottom: 80, left: 50, width: 360 }}>
        <Text style={{ letterSpacing: 4, color: COLORS.ink, marginBottom: 8, fontSize: 16 }}>
          {d.location || ''}
        </Text>
        <Text
          style={{
            lineHeight: 1.7,
            color: COLORS.ink2,
            fontSize: 16,
            fontFamily: PDF_FONTS.sansCn,
          }}
        >
          {d.caption || ''}
        </Text>
      </View>
      <PdfFolio folio={d.folio} totalPages={totalPages} fallback="03" />
    </PdfPageShell>
  );
}
