import { PDF_FONTS } from '../constants';
import { PdfFolio, PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';
import { resolveThemeCarrier } from '../theme-carrier';

export function PdfMag06({ data, totalPages, imagePos }: TemplateRenderProps) {
  const d = data as { folio?: string; image?: string };
  const folioTheme = resolveThemeCarrier(data, 'folio');
  return (
    <PdfPageShell fontFamily={PDF_FONTS.sansEn}>
      <PdfImage
        src={d.image}
        style={{ position: 'absolute', left: 83, top: 90, width: 628, height: 943 }}
        position={imagePos?.['image']}
      />
      <PdfFolio folio={d.folio} totalPages={totalPages} accentColor={folioTheme.accentColor} fallback="06" />
    </PdfPageShell>
  );
}
