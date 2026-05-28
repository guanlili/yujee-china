import { Text } from '@react-pdf/renderer';
import { COLORS, PDF_FONTS } from '../constants';
import { PdfFolio, PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';

export function PdfMag19({ data, totalPages }: TemplateRenderProps) {
  const d = data as {
    image?: string;
    intro?: string;
    captionLeft?: string;
    captionRight?: string;
    quote?: string;
    folio?: string;
  };
  // PDF 不支持 writingMode: vertical-rl,Frame 提示退化为水平摆放
  return (
    <PdfPageShell fontFamily={PDF_FONTS.sansEn}>
      <Text
        style={{
          position: 'absolute',
          top: 230,
          left: 200,
          right: 200,
          textAlign: 'center',
          lineHeight: 1.7,
          color: COLORS.ink2,
          fontSize: 16,
        }}
      >
        {d.intro || ''}
      </Text>
      <PdfImage
        src={d.image}
        style={{ position: 'absolute', top: 340, left: 70, right: 70, height: 460 }}
      />
      <Text
        style={{
          position: 'absolute',
          top: 815,
          left: 70,
          width: 280,
          lineHeight: 1.7,
          color: COLORS.ink2,
          fontSize: 16,
        }}
      >
        {d.captionLeft || ''}
      </Text>
      <Text
        style={{
          position: 'absolute',
          top: 815,
          right: 70,
          width: 280,
          lineHeight: 1.7,
          color: COLORS.ink2,
          textAlign: 'right',
          fontSize: 16,
        }}
      >
        {d.captionRight || ''}
      </Text>
      <Text
        style={{
          position: 'absolute',
          top: 340,
          right: 70,
          width: 20,
          fontSize: 10,
          letterSpacing: 4,
          color: COLORS.ink3,
        }}
      >
        {`FRAME ${d.folio || '19'} / 30`}
      </Text>
      <Text
        style={{
          position: 'absolute',
          bottom: 95,
          left: 70,
          right: 70,
          textAlign: 'center',
          fontFamily: PDF_FONTS.serifEn,
          fontStyle: 'italic',
          color: COLORS.ink,
          fontSize: 16,
        }}
      >
        {d.quote || ''}
      </Text>
      <PdfFolio folio={d.folio} totalPages={totalPages} fallback="19" />
    </PdfPageShell>
  );
}
