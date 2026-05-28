import { Text, View } from '@react-pdf/renderer';
import { COLORS, PDF_FONTS } from '../constants';
import { PdfFolio, PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';

export function PdfMag09({ data, totalPages }: TemplateRenderProps) {
  const d = data as {
    imageTop?: string;
    imageMain?: string;
    quote?: string;
    caption1?: string;
    title?: string;
    caption2?: string;
    caption3?: string;
    folio?: string;
  };
  return (
    <PdfPageShell fontFamily={PDF_FONTS.sansEn}>
      <PdfImage
        src={d.imageTop}
        style={{ position: 'absolute', top: 110, left: 60, width: 280, height: 210 }}
      />
      <View style={{ position: 'absolute', top: 130, right: 60, width: 230 }}>
        <Text
          style={{
            fontFamily: PDF_FONTS.serifEn,
            fontStyle: 'italic',
            fontSize: 16,
            lineHeight: 1.55,
            color: COLORS.ink,
          }}
        >
          {d.quote || ''}
        </Text>
        <Text
          style={{
            marginTop: 14,
            lineHeight: 1.7,
            color: COLORS.ink2,
            textAlign: 'justify',
            fontSize: 16,
          }}
        >
          {d.caption1 || ''}
        </Text>
      </View>
      <Text
        style={{
          position: 'absolute',
          top: 380,
          left: 60,
          fontFamily: PDF_FONTS.serifEn,
          fontSize: 64,
          letterSpacing: 4,
          lineHeight: 1.05,
          color: COLORS.ink,
        }}
      >
        {d.title || 'OSAKA\nJAPAN'}
      </Text>
      <PdfImage
        src={d.imageMain}
        style={{ position: 'absolute', top: 590, right: 60, width: 360, height: 330 }}
      />
      <View style={{ position: 'absolute', top: 620, left: 60, width: 280 }}>
        <Text style={{ lineHeight: 1.75, color: COLORS.ink2, textAlign: 'justify', fontSize: 16 }}>
          {d.caption2 || ''}
        </Text>
        <Text style={{ marginTop: 12, lineHeight: 1.75, color: COLORS.ink2, textAlign: 'justify', fontSize: 16 }}>
          {d.caption3 || ''}
        </Text>
      </View>
      <PdfFolio folio={d.folio} totalPages={totalPages} fallback="09" />
    </PdfPageShell>
  );
}
