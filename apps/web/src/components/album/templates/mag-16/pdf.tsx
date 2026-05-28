import { Text } from '@react-pdf/renderer';
import { COLORS, PDF_FONTS } from '../constants';
import { PdfFolio, PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';

export function PdfMag16({ data, totalPages }: TemplateRenderProps) {
  const d = data as {
    imageTiny?: string;
    imagePerson?: string;
    imageHarbor?: string;
    caption1?: string;
    caption2?: string;
    caption3?: string;
    quote?: string;
    folio?: string;
  };
  const cap = {
    lineHeight: 1.7,
    color: COLORS.ink2,
    textAlign: 'justify' as const,
    fontSize: 16,
  };
  return (
    <PdfPageShell fontFamily={PDF_FONTS.sansEn}>
      <Text style={{ position: 'absolute', top: 110, left: 70, width: 340, ...cap }}>
        {d.caption1 || ''}
      </Text>
      <PdfImage
        src={d.imageTiny}
        style={{ position: 'absolute', top: 110, right: 70, width: 220, height: 180 }}
      />
      <Text style={{ position: 'absolute', top: 330, left: 70, width: 340, ...cap }}>
        {d.caption2 || ''}
      </Text>
      <PdfImage
        src={d.imagePerson}
        style={{ position: 'absolute', top: 470, left: 70, width: 290, height: 220 }}
      />
      <PdfImage
        src={d.imageHarbor}
        style={{ position: 'absolute', top: 470, right: 70, width: 290, height: 220 }}
      />
      <Text
        style={{
          position: 'absolute',
          top: 730,
          right: 70,
          width: 290,
          fontFamily: PDF_FONTS.serifEn,
          fontStyle: 'italic',
          lineHeight: 1.6,
          color: COLORS.ink,
          textAlign: 'right',
          fontSize: 16,
        }}
      >
        {d.quote || ''}
      </Text>
      <Text
        style={{
          position: 'absolute',
          top: 730,
          left: 70,
          width: 290,
          lineHeight: 1.75,
          color: COLORS.ink2,
          textAlign: 'justify',
          fontSize: 16,
        }}
      >
        {d.caption3 || ''}
      </Text>
      <PdfFolio folio={d.folio} totalPages={totalPages} fallback="16" />
    </PdfPageShell>
  );
}
