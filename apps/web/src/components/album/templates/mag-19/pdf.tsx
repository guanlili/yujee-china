import { Text } from '@react-pdf/renderer';
import { COLORS, PDF_FONTS } from '../constants';
import { PdfFolio, PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';
import { resolveThemeCarrier } from '../theme-carrier';

const hasCjk = (s: string | undefined) => /[一-鿿]/.test(s || '');

export function PdfMag19({ data, totalPages, imagePos }: TemplateRenderProps) {
  const d = data as {
    image?: string;
    title?: string;
    explain1?: string;
    explain2?: string;
    folio?: string;
  };
  const introTheme = resolveThemeCarrier(data, 'title');
  const introText = introTheme.text ?? d.title ?? '';
  const introFont = hasCjk(introText) ? PDF_FONTS.serifCn : PDF_FONTS.playfair;
  // PDF 不支持 writingMode: vertical-rl,Frame 提示退化为水平摆放
  return (
    <PdfPageShell fontFamily={PDF_FONTS.sansEn}>
      <Text
        style={{
          position: 'absolute',
          top: 78,
          left: 60,
          width: 674,
          textAlign: 'center',
          lineHeight: 1.05,
          color: introTheme.accentColor ?? COLORS.ink,
          fontSize: 72,
          fontStyle: 'italic',
          fontFamily: introFont,
        }}
      >
        {introText}
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
          fontFamily: PDF_FONTS.montserrat,
        }}
      >
        {d.explain1 || ''}
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
          fontFamily: PDF_FONTS.montserrat,
        }}
      >
        {d.explain2 || ''}
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
