import { Text } from '@react-pdf/renderer';
import { COLORS, PDF_FONTS } from '../constants';
import { PdfFolio, PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';

export function PdfMag19({ data, totalPages, imagePos }: TemplateRenderProps) {
  const d = data as {
    image?: string;
    intro?: string;
    captionLeft?: string;
    captionRight?: string;
    folio?: string;
  };
  // PDF 不支持 writingMode: vertical-rl,Frame 提示退化为水平摆放
  return (
    <PdfPageShell fontFamily={PDF_FONTS.sansEn}>
      <Text
        style={{
          position: 'absolute',
          top: 100,
          left: 70,
          right: 70,
          textAlign: 'center',
          lineHeight: 1.4,
          color: COLORS.ink,
          fontSize: 45,
        }}
      >
        {d.intro || ''}
      </Text>
      <PdfImage
        src={d.image}
        style={{ position: 'absolute', top: 170, left: 60, width: 674, height: 674 }}
        position={imagePos?.['image']}
      />
      <Text
        style={{
          position: 'absolute',
          top: 868,
          left: 60,
          width: 300,
          lineHeight: 1.7,
          color: COLORS.ink2,
          fontSize: 18,
        }}
      >
        {d.captionLeft || ''}
      </Text>
      <Text
        style={{
          position: 'absolute',
          top: 868,
          right: 60,
          width: 300,
          lineHeight: 1.7,
          color: COLORS.ink2,
          textAlign: 'right',
          fontSize: 18,
        }}
      >
        {d.captionRight || ''}
      </Text>
      <Text
        style={{
          position: 'absolute',
          top: 420,
          right: 70,
          width: 20,
          fontSize: 10,
          letterSpacing: 4,
          color: COLORS.ink3,
        }}
      >
        {`FRAME ${d.folio || '19'} / 30`}
      </Text>
      <PdfFolio folio={d.folio} totalPages={totalPages} fallback="19" />
    </PdfPageShell>
  );
}
