import { Text, View } from '@react-pdf/renderer';
import { COLORS, PDF_FONTS } from '../constants';
import { PdfFolio, PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';

export function PdfMag04({ data, totalPages, imagePos }: TemplateRenderProps) {
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
      <PdfImage src={d.image1} style={{ position: 'absolute', top: 60, left: 50, width: 380, height: 360 }} position={imagePos?.['image1']} />
      <View
        style={{
          position: 'absolute',
          top: 180,
          left: 464,
          width: 280,
          height: 80,
          flexDirection: 'row',
          justifyContent: 'flex-end',
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
          top: 500,
          left: 60,
          width: 347,
          lineHeight: 1.75,
          color: COLORS.ink2,
          textAlign: 'justify',
          fontSize: 20,
        }}
      >
        {d.caption1 || ''}
      </Text>
      <PdfImage src={d.image2} style={{ position: 'absolute', top: 460, right: 50, width: 280, height: 280 }} position={imagePos?.['image2']} />
      <Text
        style={{
          position: 'absolute',
          top: 760,
          left: 60,
          width: 300,
          lineHeight: 1.75,
          color: COLORS.ink2,
          textAlign: 'justify',
          fontSize: 20,
        }}
      >
        {d.caption2 || ''}
      </Text>
      <PdfImage src={d.image3} style={{ position: 'absolute', top: 760, right: 50, width: 280, height: 280 }} position={imagePos?.['image3']} />
      <PdfFolio folio={d.folio} totalPages={totalPages} fallback="04" />
    </PdfPageShell>
  );
}
