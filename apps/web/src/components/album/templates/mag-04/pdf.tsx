import { Text, View } from '@react-pdf/renderer';
import { COLORS, PDF_FONTS } from '../constants';
import { PdfFolio, PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';

export function PdfMag04({ data, totalPages }: TemplateRenderProps) {
  const d = data as {
    image1?: string;
    image2?: string;
    image3?: string;
    caption1?: string;
    caption2?: string;
    dateNum?: string;
    folio?: string;
  };
  const dn = (d.dateNum || '04/24').split('/');
  return (
    <PdfPageShell fontFamily={PDF_FONTS.sansEn}>
      <PdfImage src={d.image1} style={{ position: 'absolute', top: 100, left: 50, width: 380, height: 300 }} />
      <View
        style={{
          position: 'absolute',
          top: 260,
          right: 50,
          flexDirection: 'row',
        }}
      >
        <Text
          style={{
            fontFamily: PDF_FONTS.serifEn,
            fontStyle: 'italic',
            fontSize: 64,
            color: COLORS.ink,
          }}
        >
          {dn[0]}
        </Text>
        <Text
          style={{
            fontFamily: PDF_FONTS.serifEn,
            fontStyle: 'italic',
            fontSize: 64,
            color: COLORS.ink3,
          }}
        >
          /{dn[1] || ''}
        </Text>
      </View>
      <Text
        style={{
          position: 'absolute',
          top: 440,
          left: 50,
          width: 300,
          lineHeight: 1.75,
          color: COLORS.ink2,
          textAlign: 'justify',
          fontSize: 16,
        }}
      >
        {d.caption1 || ''}
      </Text>
      <PdfImage src={d.image2} style={{ position: 'absolute', top: 430, right: 50, width: 230, height: 280 }} />
      <Text
        style={{
          position: 'absolute',
          top: 760,
          left: 50,
          width: 300,
          lineHeight: 1.75,
          color: COLORS.ink2,
          textAlign: 'justify',
          fontSize: 16,
        }}
      >
        {d.caption2 || ''}
      </Text>
      <PdfImage src={d.image3} style={{ position: 'absolute', top: 740, right: 50, width: 230, height: 230 }} />
      <PdfFolio folio={d.folio} totalPages={totalPages} fallback="04" />
    </PdfPageShell>
  );
}
