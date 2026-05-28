import { Text, View } from '@react-pdf/renderer';
import { COLORS, PDF_FONTS } from '../constants';
import { PdfFolio, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';

export function PdfMag20({ data, totalPages }: TemplateRenderProps) {
  const d = data as {
    boxText?: string;
    title?: string;
    plate?: string;
    folio?: string;
  };
  return (
    <PdfPageShell fontFamily={PDF_FONTS.sansEn}>
      <View
        style={{
          position: 'absolute',
          top: 220,
          left: 120,
          width: 260,
          borderWidth: 1,
          borderColor: COLORS.ruleLight,
          paddingVertical: 16,
          paddingHorizontal: 18,
        }}
      >
        <Text
          style={{
            lineHeight: 1.7,
            color: COLORS.ink2,
            fontSize: 16,
          }}
        >
          {d.boxText || ''}
        </Text>
      </View>
      <Text
        style={{
          position: 'absolute',
          top: 620,
          left: 120,
          fontFamily: PDF_FONTS.serifEn,
          fontSize: 38,
          letterSpacing: 8,
          lineHeight: 1.4,
          color: COLORS.ink,
        }}
      >
        {d.title || 'MASASHI WAKUI\nAT NIGHT'}
      </Text>
      <View
        style={{
          position: 'absolute',
          top: 770,
          left: 120,
          width: 60,
          height: 1,
          backgroundColor: COLORS.ink,
        }}
      />
      <Text
        style={{
          position: 'absolute',
          top: 790,
          left: 120,
          letterSpacing: 4,
          color: COLORS.ink3,
          fontSize: 16,
        }}
      >
        {(d.plate || '').toUpperCase()}
      </Text>
      <PdfFolio folio={d.folio} totalPages={totalPages} fallback="20" />
    </PdfPageShell>
  );
}
