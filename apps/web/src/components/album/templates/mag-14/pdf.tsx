import { Text, View } from '@react-pdf/renderer';
import { COLORS, PDF_FONTS } from '../constants';
import { PdfFolio, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';

export function PdfMag14({ data, totalPages }: TemplateRenderProps) {
  const d = data as {
    bigNum?: string;
    bigNumTotal?: string;
    body?: string;
    subtitleQuote?: string;
    bracketQuote?: string;
    footnote?: string;
    folio?: string;
  };
  return (
    <PdfPageShell fontFamily={PDF_FONTS.sansEn}>
      <View style={{ position: 'absolute', top: 230, left: 110, flexDirection: 'row' }}>
        <Text
          style={{
            fontFamily: PDF_FONTS.serifEn,
            fontStyle: 'italic',
            fontSize: 96,
            color: COLORS.ink,
          }}
        >
          {d.bigNum || '11'}
        </Text>
        <Text
          style={{
            fontFamily: PDF_FONTS.serifEn,
            fontStyle: 'italic',
            fontSize: 96,
            color: COLORS.ink3,
          }}
        >
          /{d.bigNumTotal || '33'}
        </Text>
      </View>
      <Text
        style={{
          position: 'absolute',
          top: 410,
          left: 110,
          width: 260,
          lineHeight: 1.85,
          color: COLORS.ink2,
          textAlign: 'justify',
          fontSize: 16,
        }}
      >
        {d.body || ''}
      </Text>
      <Text
        style={{
          position: 'absolute',
          top: 600,
          left: 110,
          right: 110,
          fontFamily: PDF_FONTS.serifEn,
          fontStyle: 'italic',
          color: COLORS.ink,
          fontSize: 16,
        }}
      >
        {d.subtitleQuote || ''}
      </Text>
      <Text
        style={{
          position: 'absolute',
          top: 680,
          left: 110,
          width: 360,
          lineHeight: 1.85,
          color: COLORS.ink2,
          textAlign: 'justify',
          fontSize: 16,
        }}
      >
        [ {d.bracketQuote || ''} ]
      </Text>
      <Text
        style={{
          position: 'absolute',
          bottom: 75,
          left: 110,
          width: 380,
          fontSize: 10,
          lineHeight: 1.7,
          color: COLORS.ink3,
          letterSpacing: 1.5,
        }}
      >
        {(d.footnote || '').toUpperCase()}
      </Text>
      <PdfFolio folio={d.folio} totalPages={totalPages} fallback="14" />
    </PdfPageShell>
  );
}
