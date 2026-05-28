import { Text } from '@react-pdf/renderer';
import { COLORS, PDF_FONTS } from '../constants';
import { PdfFolio, PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';

export function PdfMag06({ data, totalPages }: TemplateRenderProps) {
  const d = data as { category?: string; folio?: string; image?: string };
  return (
    <PdfPageShell fontFamily={PDF_FONTS.sansEn}>
      <Text
        style={{
          position: 'absolute',
          top: 60,
          left: 50,
          fontSize: 14,
          letterSpacing: 4,
          color: COLORS.ink2,
        }}
      >
        {(d.category || 'Landscape').toUpperCase()}
      </Text>
      <PdfImage
        src={d.image}
        style={{ position: 'absolute', top: 100, left: 50, right: 50, bottom: 130 }}
      />
      <PdfFolio folio={d.folio} totalPages={totalPages} fallback="06" />
    </PdfPageShell>
  );
}
