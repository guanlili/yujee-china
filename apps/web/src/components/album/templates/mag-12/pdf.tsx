import { Text, View } from '@react-pdf/renderer';
import { COLORS, PDF_FONTS } from '../constants';
import { PdfFolio, PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';

export function PdfMag12({ data, totalPages }: TemplateRenderProps) {
  const d = data as {
    imageTop?: string;
    imageBottom?: string;
    num1?: string;
    num2?: string;
    folio?: string;
  };
  // PDF 不支持 transform: rotate,斜线退化为水平细线
  return (
    <PdfPageShell fontFamily={PDF_FONTS.sansEn}>
      <Text
        style={{
          position: 'absolute',
          top: 360,
          left: 230,
          fontFamily: PDF_FONTS.serifEn,
          fontSize: 32,
          color: COLORS.ink,
        }}
      >
        {d.num1 || '13'}
      </Text>
      <View
        style={{
          position: 'absolute',
          top: 395,
          left: 268,
          width: 120,
          height: 1,
          backgroundColor: COLORS.ink,
        }}
      />
      <Text
        style={{
          position: 'absolute',
          top: 560,
          left: 330,
          fontFamily: PDF_FONTS.serifEn,
          fontSize: 32,
          color: COLORS.ink,
        }}
      >
        {d.num2 || '14'}
      </Text>
      <View
        style={{
          position: 'absolute',
          top: 595,
          left: 368,
          width: 120,
          height: 1,
          backgroundColor: COLORS.ink,
        }}
      />
      <PdfImage src={d.imageTop} style={{ position: 'absolute', top: 280, right: 70, width: 220, height: 220 }} />
      <PdfImage src={d.imageBottom} style={{ position: 'absolute', top: 520, right: 70, width: 220, height: 290 }} />
      <PdfFolio folio={d.folio} totalPages={totalPages} fallback="12" />
    </PdfPageShell>
  );
}
