import { Text } from '@react-pdf/renderer';
import { COLORS, PDF_FONTS } from '../constants';
import { PdfFolio, PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';

export function PdfMag13({ data, totalPages }: TemplateRenderProps) {
  const d = data as {
    image?: string;
    title?: string;
    caption?: string;
    folio?: string;
  };
  return (
    <PdfPageShell fontFamily={PDF_FONTS.sansEn}>
      <Text
        style={{
          position: 'absolute',
          top: 110,
          left: 90,
          right: 90,
          fontFamily: PDF_FONTS.serifEn,
          fontSize: 28,
          letterSpacing: 8,
          textAlign: 'center',
          lineHeight: 1.35,
          color: COLORS.ink,
        }}
      >
        {d.title || 'YUICHI TOKUDA\nPHOTOGRAPHY'}
      </Text>
      <PdfImage
        src={d.image}
        style={{ position: 'absolute', top: 300, left: 90, right: 90, height: 520 }}
      />
      <Text
        style={{
          position: 'absolute',
          top: 855,
          left: 130,
          right: 130,
          textAlign: 'center',
          lineHeight: 1.75,
          color: COLORS.ink2,
          fontSize: 15,
        }}
      >
        {d.caption || ''}
      </Text>
      <PdfFolio folio={d.folio} totalPages={totalPages} fallback="13" />
    </PdfPageShell>
  );
}
