import { Text, View } from '@react-pdf/renderer';
import { COLORS, PDF_FONTS } from '../constants';
import { PdfFolio, PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';

export function PdfMag08({ data, totalPages }: TemplateRenderProps) {
  const d = data as {
    image?: string;
    dateNum?: string;
    caption1?: string;
    caption2?: string;
    title?: string;
    subtitle?: string;
    folio?: string;
  };
  const dn = (d.dateNum || '08/24').split('/');
  return (
    <PdfPageShell fontFamily={PDF_FONTS.sansEn}>
      <View
        style={{
          position: 'absolute',
          top: 90,
          right: 70,
          flexDirection: 'row',
        }}
      >
        <Text
          style={{
            fontFamily: PDF_FONTS.serifEn,
            fontStyle: 'italic',
            fontSize: 46,
            color: COLORS.ink,
          }}
        >
          {dn[0]}
        </Text>
        <Text
          style={{
            fontFamily: PDF_FONTS.serifEn,
            fontStyle: 'italic',
            fontSize: 46,
            color: COLORS.ink2,
          }}
        >
          /
        </Text>
        <Text
          style={{
            fontFamily: PDF_FONTS.serifEn,
            fontStyle: 'italic',
            fontSize: 46,
            color: COLORS.ink,
          }}
        >
          {dn[1] || ''}
        </Text>
      </View>
      <PdfImage
        src={d.image}
        style={{ position: 'absolute', top: 100, left: 70, width: 360, height: 440 }}
      />
      <View style={{ position: 'absolute', top: 670, left: 70, width: 305 }}>
        <Text style={{ fontSize: 14, lineHeight: 1.7, color: COLORS.ink2, textAlign: 'justify' }}>
          {d.caption1 || ''}
        </Text>
      </View>
      <View style={{ position: 'absolute', top: 670, left: 403, width: 305 }}>
        <Text style={{ fontSize: 14, lineHeight: 1.7, color: COLORS.ink2, textAlign: 'justify' }}>
          {d.caption2 || ''}
        </Text>
      </View>
      <Text
        style={{
          position: 'absolute',
          bottom: 130,
          left: 70,
          fontFamily: PDF_FONTS.serifEn,
          fontSize: 60,
          letterSpacing: 5,
          color: COLORS.ink,
        }}
      >
        {d.title || 'EVENT'}
      </Text>
      <Text
        style={{
          position: 'absolute',
          bottom: 95,
          left: 72,
          fontSize: 14,
          letterSpacing: 4,
          color: COLORS.ink2,
        }}
      >
        {(d.subtitle || '').toUpperCase()}
      </Text>
      <PdfFolio folio={d.folio} totalPages={totalPages} fallback="08" />
    </PdfPageShell>
  );
}
