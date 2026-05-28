import { Text, View } from '@react-pdf/renderer';
import { COLORS, PDF_FONTS } from '../constants';
import { PdfFolio, PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';

export function PdfMag01({ data, totalPages }: TemplateRenderProps) {
  const d = data as {
    heading?: string;
    sideText?: string;
    caption1?: string;
    caption2?: string;
    folio?: string;
    image?: string;
  };
  return (
    <PdfPageShell fontFamily={PDF_FONTS.sansEn}>
      <View
        style={{
          position: 'absolute',
          top: 140,
          left: 130,
          right: 130,
          flexDirection: 'row',
          alignItems: 'center',
        }}
      >
        <Text style={{ letterSpacing: 8, fontSize: 24, color: COLORS.ink }}>
          {d.heading || 'VENUES'}
        </Text>
        <View style={{ flexGrow: 1, height: 1, backgroundColor: COLORS.ink, marginHorizontal: 16 }} />
        <View
          style={{
            width: 26,
            height: 26,
            borderRadius: 13,
            borderWidth: 1,
            borderColor: COLORS.ink,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontFamily: PDF_FONTS.mono, fontSize: 14, color: COLORS.ink }}>N</Text>
        </View>
      </View>
      <Text
        style={{
          position: 'absolute',
          top: 280,
          left: 56,
          letterSpacing: 4,
          color: COLORS.ink2,
          fontSize: 14,
          textTransform: 'uppercase',
          width: 14,
        }}
      >
        {d.sideText || ''}
      </Text>
      <PdfImage
        src={d.image}
        style={{ position: 'absolute', top: 240, right: 0, width: 660, height: 460 }}
      />
      <Text
        style={{
          position: 'absolute',
          left: 130,
          top: 760,
          lineHeight: 1.7,
          color: COLORS.ink2,
          fontSize: 16,
          width: 264,
        }}
      >
        {d.caption1 || ''}
      </Text>
      <Text
        style={{
          position: 'absolute',
          left: 130,
          top: 880,
          lineHeight: 1.7,
          color: COLORS.ink2,
          textAlign: 'justify',
          fontSize: 16,
          width: 264,
        }}
      >
        {d.caption2 || ''}
      </Text>
      <View
        style={{
          position: 'absolute',
          bottom: 90,
          left: 130,
          right: 130,
          height: 1,
          backgroundColor: COLORS.ruleLight,
        }}
      />
      <PdfFolio folio={d.folio} totalPages={totalPages} fallback="01" />
    </PdfPageShell>
  );
}
