import { PDF_FONTS } from '../constants';
import { PdfFolio, PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';

export function PdfMag06({ data, totalPages }: TemplateRenderProps) {
  const d = data as { folio?: string; image?: string };
  return (
    <PdfPageShell fontFamily={PDF_FONTS.sansEn}>
      <PdfImage
        src={d.image}
        style={{ position: 'absolute', left: 83, top: 90, width: 628, height: 943 }}
      />
      <PdfFolio folio={d.folio} totalPages={totalPages} fallback="06" />
    </PdfPageShell>
  );
}
