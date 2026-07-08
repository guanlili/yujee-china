import { Text, View } from '@react-pdf/renderer';
import { COLORS, PDF_FONTS } from '../constants';
import { PdfFolio, PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';
import { resolveThemeCarrier } from '../theme-carrier';

const hasCjk = (s: string | undefined) => /[一-鿿]/.test(s || '');

export function PdfMag04({ data, totalPages, imagePos }: TemplateRenderProps) {
  const d = data as {
    image1?: string;
    image2?: string;
    explain1?: string;
    explain2?: string;
    date?: string;
    folio?: string;
  };
  const dateTheme = resolveThemeCarrier(data, 'date');
  const explain1Theme = resolveThemeCarrier(data, 'explain1');
  const explain2Theme = resolveThemeCarrier(data, 'explain2');
  const folioTheme = resolveThemeCarrier(data, 'folio');
  const dateText = dateTheme.text ?? d.date ?? '04/24';
  const dn = dateText.split('/');
  // 展示主元素：大号日期用 Bebas Neue（纯拉丁安全）；含中文回退 serifCn 避免豆腐块
  const dateFont = dateTheme.pdfFontFamily ?? (hasCjk(dateText) ? PDF_FONTS.serifCn : PDF_FONTS.bebas);
  return (
    <PdfPageShell fontFamily={PDF_FONTS.sansEn}>
      <PdfImage src={d.image1} style={{ position: 'absolute', top: 60, left: 50, width: 380, height: 360 }} position={imagePos?.['image1']} />
      {/* 展示主元素：大号日期数字（Bebas Neue，高瘦大写展示字） */}
      <View
        style={{
          position: 'absolute',
          top: 150,
          left: 424,
          width: 320,
          height: 120,
          flexDirection: 'row',
          justifyContent: 'flex-end',
        }}
      >
        <Text
          style={{
            fontFamily: dateFont,
            fontSize: 108,
            letterSpacing: 4,
            color: dateTheme.accentColor ?? COLORS.ink,
          }}
        >
          {dn[0]}
        </Text>
        <Text
          style={{
            fontFamily: dateFont,
            fontSize: 108,
            letterSpacing: 4,
            marginLeft: 8,
            color: dateTheme.accentColor ?? COLORS.ink3,
          }}
        >
          /{dn[1] || ''}
        </Text>
      </View>
      <Text
        style={{
          position: 'absolute',
          top: 500,
          left: 60,
          width: 347,
          fontFamily: hasCjk(d.explain1) ? PDF_FONTS.serifCn : PDF_FONTS.montserrat,
          lineHeight: 1.75,
          color: explain1Theme.accentColor ?? COLORS.ink2,
          textAlign: 'justify',
          fontSize: 18,
        }}
      >
        {d.explain1 || ''}
      </Text>
      <PdfImage src={d.image2} style={{ position: 'absolute', top: 460, right: 50, width: 280, height: 580 }} position={imagePos?.['image2']} />
      {/* explain2 左侧加粗竖线，上下与两行文字对齐（18×1.75×2 ≈ 63px） */}
      <View
        style={{
          position: 'absolute',
          top: 760,
          left: 48,
          width: 4,
          height: 63,
          backgroundColor: COLORS.ink2,
        }}
      />
      <Text
        style={{
          position: 'absolute',
          top: 760,
          left: 60,
          width: 347,
          fontFamily: hasCjk(d.explain2) ? PDF_FONTS.serifCn : PDF_FONTS.montserrat,
          lineHeight: 1.75,
          color: explain2Theme.accentColor ?? COLORS.ink2,
          textAlign: 'justify',
          fontSize: 18,
        }}
      >
        {d.explain2 || ''}
      </Text>
      <PdfFolio folio={d.folio} totalPages={totalPages} accentColor={folioTheme.accentColor} fallback="04" />
    </PdfPageShell>
  );
}
