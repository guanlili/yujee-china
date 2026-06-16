import { Text, View } from '@react-pdf/renderer';
import { COLORS, PDF_FONTS } from '../constants';
import { PdfFolio, PdfImage, PdfPageShell } from '../pdf-utils';
import type { GridCell, TemplateData, TemplateRenderProps } from '../types';

export function PdfMag10({ data, totalPages, imagePos }: TemplateRenderProps) {
  const d = data as TemplateData & { cells?: GridCell[]; folio?: string };
  const fallbackCells: GridCell[] = [
    { n: '09', image: '', caption: '' },
    { n: '10', image: '', caption: '' },
    { n: '11', image: '', caption: '' },
    { n: '12', image: '', caption: '' },
  ];
  const cells = (d.cells ?? fallbackCells).slice(0, 4);
  const merged = cells.map((c, i) => ({
    ...c,
    image: c.image || (d[`cells[${i}].image`] as string | undefined) || '',
  }));
  const cellW = (794 - 60 * 2 - 50) / 2;
  return (
    <PdfPageShell fontFamily={PDF_FONTS.sansEn}>
      {merged.map((c, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const x = 60 + col * (cellW + 50);
        const y = 130 + row * (28 + 280 + 12 + 80);
        return (
          <View key={c.n ?? i} style={{ position: 'absolute', top: y, left: x, width: cellW }}>
            <Text
              style={{
                fontFamily: PDF_FONTS.serifEn,
                fontSize: 22,
                color: COLORS.ink,
                marginBottom: 12,
              }}
            >
              {i + 1}
            </Text>
            <PdfImage src={c.image} style={{ width: cellW, height: 280 }} position={imagePos?.[`cells[${i}].image`]} />
            <Text
              style={{
                marginTop: 12,
                lineHeight: 1.7,
                color: COLORS.ink2,
                textAlign: 'justify',
                fontSize: 18,
              }}
            >
              {c.caption || ''}
            </Text>
          </View>
        );
      })}
      <PdfFolio folio={d.folio} totalPages={totalPages} fallback="10" />
    </PdfPageShell>
  );
}
