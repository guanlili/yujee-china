import { Text, View } from '@react-pdf/renderer';
import { COLORS, PDF_FONTS } from '../constants';
import { PdfFolio, PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';

export function PdfMag05({ data, totalPages }: TemplateRenderProps) {
  const d = data as {
    title?: string;
    topRight?: string;
    caption?: string;
    folio?: string;
    image?: string;
  };
  return (
    <PdfPageShell fontFamily={PDF_FONTS.sansEn}>
      <Text
        style={{
          position: 'absolute',
          top: 110,
          left: 50,
          right: 280,
          fontFamily: PDF_FONTS.serifEn,
          fontSize: 44,
          lineHeight: 1.15,
          color: COLORS.ink,
        }}
      >
        {d.title || "LET'S GO RIDE\nA BIKE"}
      </Text>
      <Text
        style={{
          position: 'absolute',
          top: 60,
          right: 50,
          fontSize: 14,
          letterSpacing: 4,
          color: COLORS.ink2,
        }}
      >
        {d.topRight || 'JOURNEY · 05'}
      </Text>
      <View style={{ position: 'absolute', top: 290, left: 50, width: 320 }}>
        <Text
          style={{
            fontFamily: PDF_FONTS.serifEn,
            fontStyle: 'italic',
            fontSize: 20,
            color: COLORS.ink3,
            marginBottom: 10,
          }}
        >
          i.
        </Text>
        <Text
          style={{
            lineHeight: 1.75,
            color: COLORS.ink2,
            textAlign: 'justify',
            fontSize: 16,
          }}
        >
          {d.caption || ''}
        </Text>
      </View>
      <PdfImage src={d.image} style={{ position: 'absolute', top: 560, left: 50, right: 50, height: 460 }} />
      <PdfFolio folio={d.folio} totalPages={totalPages} fallback="05" />
    </PdfPageShell>
  );
}
