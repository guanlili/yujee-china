import { Text, View } from '@react-pdf/renderer';
import { COLORS, PDF_FONTS } from '../constants';
import { PdfFolio, PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';

export function PdfMag18({ data, totalPages }: TemplateRenderProps) {
  const d = data as {
    imageLeft?: string;
    imageRight?: string;
    numLeft?: string;
    numRight?: string;
    captionLeft?: string;
    captionRight?: string;
    subtitle?: string;
    folio?: string;
  };
  return (
    <PdfPageShell fontFamily={PDF_FONTS.sansEn}>
      <Text
        style={{
          position: 'absolute',
          top: 110,
          left: 110,
          fontFamily: PDF_FONTS.serifEn,
          fontSize: 26,
          color: COLORS.ink,
        }}
      >
        {d.numLeft || '19'}
      </Text>
      <Text
        style={{
          position: 'absolute',
          top: 110,
          left: 427,
          fontFamily: PDF_FONTS.serifEn,
          fontSize: 26,
          color: COLORS.ink,
        }}
      >
        {d.numRight || '20'}
      </Text>
      <PdfImage
        src={d.imageLeft}
        style={{ position: 'absolute', top: 170, left: 70, width: 320, height: 380 }}
      />
      <PdfImage
        src={d.imageRight}
        style={{ position: 'absolute', top: 170, right: 70, width: 320, height: 380 }}
      />
      <View
        style={{
          position: 'absolute',
          top: 580,
          left: 70,
          right: 70,
          height: 1,
          backgroundColor: COLORS.ruleLight,
        }}
      />
      <Text
        style={{
          position: 'absolute',
          top: 605,
          left: 70,
          width: 320,
          lineHeight: 1.75,
          color: COLORS.ink2,
          textAlign: 'justify',
          fontSize: 16,
        }}
      >
        {d.captionLeft || ''}
      </Text>
      <Text
        style={{
          position: 'absolute',
          top: 605,
          right: 70,
          width: 320,
          lineHeight: 1.75,
          color: COLORS.ink2,
          textAlign: 'justify',
          fontSize: 16,
        }}
      >
        {d.captionRight || ''}
      </Text>
      <Text
        style={{
          position: 'absolute',
          bottom: 130,
          left: 70,
          right: 70,
          textAlign: 'center',
          fontFamily: PDF_FONTS.serifEn,
          fontStyle: 'italic',
          fontSize: 13,
          color: COLORS.ink2,
        }}
      >
        {d.subtitle || ''}
      </Text>
      <PdfFolio folio={d.folio} totalPages={totalPages} fallback="18" />
    </PdfPageShell>
  );
}
