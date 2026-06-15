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
      <PdfImage src={d.image} style={{ position: 'absolute', top: 430, left: 50, right: 50, height: 600 }} />
      <PdfFolio folio={d.folio} totalPages={totalPages} fallback="05" />
    </PdfPageShell>
  );
}
