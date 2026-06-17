import { Text } from '@react-pdf/renderer';
import { COLORS, PDF_FONTS } from '../constants';
import { PdfFolio, PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';

export function PdfMag15({ data, totalPages, imagePos }: TemplateRenderProps) {
  const d = data as {
    imagePerson?: string;
    imageRoad?: string;
    body?: string;
    title?: string;
    date?: string;
    folio?: string;
  };
  return (
    <PdfPageShell fontFamily={PDF_FONTS.sansEn}>
      <Text
        style={{
          position: 'absolute',
          top: 90,
          left: 70,
          width: 280,
          lineHeight: 1.7,
          color: COLORS.ink2,
          textAlign: 'justify',
          fontSize: 18,
        }}
      >
        {d.body || ''}
      </Text>
      <PdfImage
        src={d.imagePerson}
        style={{ position: 'absolute', top: 180, right: 70, width: 655, height: 440 }}
        position={imagePos?.['imagePerson']}
      />
      <PdfImage
        src={d.imageRoad}
        style={{ position: 'absolute', top: 660, left: 70, width: 400, height: 350 }}
        position={imagePos?.['imageRoad']}
      />
      <Text
        style={{
          position: 'absolute',
          top: 750,
          right: 70,
          textAlign: 'right',
          fontFamily: PDF_FONTS.serifEn,
          fontSize: 54,
          letterSpacing: 5,
          lineHeight: 1.1,
          color: COLORS.ink,
        }}
      >
        {d.title || 'HAPPY\nCHOFU'}
      </Text>
      <Text
        style={{
          position: 'absolute',
          bottom: 95,
          right: 72,
          fontSize: 11,
          letterSpacing: 4,
          color: COLORS.ink2,
        }}
      >
        {(d.date || '').toUpperCase()}
      </Text>
      <PdfFolio folio={d.folio} totalPages={totalPages} fallback="15" />
    </PdfPageShell>
  );
}
