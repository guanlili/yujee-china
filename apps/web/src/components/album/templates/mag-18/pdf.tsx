import { Text, View } from '@react-pdf/renderer';
import { COLORS, PDF_FONTS } from '../constants';
import { PdfFolio, PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';
import { resolveThemeCarrier } from '../theme-carrier';

// 图注含中文回退 serifCn（Noto SC）避免豆腐块，纯英文走 Montserrat（指定艺术字，与 web 一致）。
const hasCjk = (s: string | undefined) => /[一-鿿]/.test(s || '');
const capFont = (text: string) => (hasCjk(text) ? PDF_FONTS.serifCn : PDF_FONTS.montserrat);

export function PdfMag18({ data, totalPages, imagePos }: TemplateRenderProps) {
  const d = data as {
    image1?: string;
    image2?: string;
    explain1?: string;
    explain2?: string;
    folio?: string;
  };
  const explain1Theme = resolveThemeCarrier(data, 'explain1');
  const explain2Theme = resolveThemeCarrier(data, 'explain2');
  const folioTheme = resolveThemeCarrier(data, 'folio');
  return (
    <PdfPageShell fontFamily={PDF_FONTS.sansEn}>
      <PdfImage
        src={d.image1}
        style={{ position: 'absolute', top: 170, left: 70, width: 320, height: 600 }}
        position={imagePos?.['image1']}
      />
      <PdfImage
        src={d.image2}
        style={{ position: 'absolute', top: 170, right: 70, width: 320, height: 600 }}
        position={imagePos?.['image2']}
      />
      {/* 左图：极小 Montserrat 大写 eyebrow + 图注 */}
      <View style={{ position: 'absolute', top: 778, left: 70, width: 320 }}>
        <Text
          style={{
            fontFamily: PDF_FONTS.montserrat,
            fontSize: 8,
            letterSpacing: 2.4,
            color: COLORS.ink3,
            marginBottom: 7,
          }}
        >
          PLATE I
        </Text>
        <Text
          style={{
            fontFamily: capFont(d.explain1 || ''),
            lineHeight: 1.75,
            color: explain1Theme.accentColor ?? COLORS.ink2,
            textAlign: 'justify',
            letterSpacing: 0.3,
            fontSize: 15,
          }}
        >
          {d.explain1 || ''}
        </Text>
      </View>
      {/* 右图：极小 Montserrat 大写 eyebrow + 图注 */}
      <View style={{ position: 'absolute', top: 778, right: 70, width: 320 }}>
        <Text
          style={{
            fontFamily: PDF_FONTS.montserrat,
            fontSize: 8,
            letterSpacing: 2.4,
            color: COLORS.ink3,
            marginBottom: 7,
          }}
        >
          PLATE II
        </Text>
        <Text
          style={{
            fontFamily: capFont(d.explain2 || ''),
            lineHeight: 1.75,
            color: explain2Theme.accentColor ?? COLORS.ink2,
            textAlign: 'justify',
            letterSpacing: 0.3,
            fontSize: 15,
          }}
        >
          {d.explain2 || ''}
        </Text>
      </View>
      <PdfFolio folio={d.folio} totalPages={totalPages} accentColor={folioTheme.accentColor} fallback="18" />
    </PdfPageShell>
  );
}
