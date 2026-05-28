import { Text, View } from '@react-pdf/renderer';
import { COLORS, PDF_FONTS } from '../constants';
import { PdfFolio, PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';

export function PdfMag13({ data, totalPages }: TemplateRenderProps) {
  const d = data as {
    image?: string;
    title?: string;
    intro?: string;
    caption1?: string;
    caption2?: string;
    issue?: string;
    credit?: string;
    folio?: string;
  };
  return (
    <PdfPageShell fontFamily={PDF_FONTS.sansEn}>
      <Text
        style={{
          position: 'absolute',
          top: 110,
          left: 90,
          right: 90,
          fontFamily: PDF_FONTS.serifEn,
          fontSize: 28,
          letterSpacing: 8,
          textAlign: 'center',
          lineHeight: 1.35,
          color: COLORS.ink,
        }}
      >
        {d.title || 'YUICHI TOKUDA\nPHOTOGRAPHY'}
      </Text>
      <Text
        style={{
          position: 'absolute',
          top: 240,
          left: 200,
          right: 200,
          textAlign: 'center',
          lineHeight: 1.7,
          color: COLORS.ink2,
          fontSize: 16,
        }}
      >
        {d.intro || ''}
      </Text>
      <PdfImage
        src={d.image}
        style={{ position: 'absolute', top: 340, left: 90, right: 90, height: 520 }}
      />
      <View style={{ position: 'absolute', bottom: 130, left: 90, width: 290 }}>
        <Text style={{ fontSize: 16, lineHeight: 1.75, color: COLORS.ink2, textAlign: 'justify' }}>
          {d.caption1 || ''}
        </Text>
      </View>
      <View style={{ position: 'absolute', bottom: 130, left: 415, width: 290 }}>
        <Text style={{ fontSize: 16, lineHeight: 1.75, color: COLORS.ink2, textAlign: 'justify' }}>
          {d.caption2 || ''}
        </Text>
      </View>
      <View
        style={{
          position: 'absolute',
          bottom: 75,
          left: 90,
          right: 90,
          flexDirection: 'row',
          justifyContent: 'space-between',
        }}
      >
        <Text style={{ fontSize: 10, letterSpacing: 3, color: COLORS.ink3 }}>
          {(d.issue || '').toUpperCase()}
        </Text>
        <Text style={{ fontSize: 10, letterSpacing: 3, color: COLORS.ink3 }}>
          {(d.credit || '').toUpperCase()}
        </Text>
      </View>
      <PdfFolio folio={d.folio} totalPages={totalPages} fallback="13" />
    </PdfPageShell>
  );
}
