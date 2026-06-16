import { Text, View } from '@react-pdf/renderer';
import { COLORS, PDF_FONTS } from '../constants';
import { PdfFolio, PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';

export function PdfMag18({ data, totalPages, imagePos }: TemplateRenderProps) {
  const d = data as {
    imageLeft?: string;
    imageRight?: string;
    captionLeft?: string;
    captionRight?: string;
    folio?: string;
  };
  return (
    <PdfPageShell fontFamily={PDF_FONTS.sansEn}>
      <PdfImage
        src={d.imageLeft}
        style={{ position: 'absolute', top: 170, left: 70, width: 320, height: 600 }}
        position={imagePos?.['imageLeft']}
      />
      <PdfImage
        src={d.imageRight}
        style={{ position: 'absolute', top: 170, right: 70, width: 320, height: 600 }}
        position={imagePos?.['imageRight']}
      />
      <Text
        style={{
          position: 'absolute',
          top: 790,
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
          top: 790,
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
      <PdfFolio folio={d.folio} totalPages={totalPages} fallback="18" />
    </PdfPageShell>
  );
}
