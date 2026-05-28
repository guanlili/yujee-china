import { Text, View } from '@react-pdf/renderer';
import { COLORS, PDF_FONTS } from '../constants';
import { PdfFolio, PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';

export function PdfMag17({ data, totalPages }: TemplateRenderProps) {
  const d = data as {
    image?: string;
    name1?: string;
    name2?: string;
    folio?: string;
  };
  return (
    <PdfPageShell fontFamily={PDF_FONTS.sansEn}>
      <PdfImage
        src={d.image}
        style={{ position: 'absolute', top: 175, left: 70, right: 70, height: 680 }}
      />
      <View style={{ position: 'absolute', bottom: 105, left: 70, right: 70 }}>
        <Text
          style={{
            textAlign: 'center',
            fontFamily: PDF_FONTS.serifEn,
            fontSize: 26,
            letterSpacing: 8,
            lineHeight: 1.2,
            color: COLORS.ink,
          }}
        >
          {(d.name1 || 'HELENA CHANG').toUpperCase()}
        </Text>
        <Text
          style={{
            textAlign: 'center',
            fontFamily: PDF_FONTS.serifEn,
            fontStyle: 'italic',
            fontSize: 22,
            color: COLORS.ink,
          }}
        >
          &amp;
        </Text>
        <Text
          style={{
            textAlign: 'center',
            fontFamily: PDF_FONTS.serifEn,
            fontSize: 26,
            letterSpacing: 8,
            lineHeight: 1.2,
            color: COLORS.ink,
          }}
        >
          {(d.name2 || 'KENJI OKABE').toUpperCase()}
        </Text>
      </View>
      <PdfFolio folio={d.folio} totalPages={totalPages} fallback="17" />
    </PdfPageShell>
  );
}
