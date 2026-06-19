import { Text, View } from '@react-pdf/renderer';
import { COLORS, PDF_FONTS } from '../constants';
import { PdfFolio, PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';
import { resolveThemeCarrier } from '../theme-carrier';

export function PdfMag08({ data, totalPages, imagePos }: TemplateRenderProps) {
  const d = data as {
    image?: string;
    dateNum?: string;
    caption1?: string;
    caption2?: string;
    title?: string;
    body?: string;
    folio?: string;
  };
  const dateTheme = resolveThemeCarrier(data, 'dateNum');
  const titleTheme = resolveThemeCarrier(data, 'title');
  const dn = (d.dateNum || '08/24').split('/');
  return (
    <PdfPageShell fontFamily={PDF_FONTS.sansEn}>
      <View
        style={{
          position: 'absolute',
          top: 90,
          right: 70,
          flexDirection: 'row',
        }}
      >
        <Text
          style={{
            fontFamily: dateTheme.pdfFontFamily ?? PDF_FONTS.serifEn,
            fontStyle: 'italic',
            fontSize: 46,
            color: dateTheme.accentColor ?? COLORS.ink,
          }}
        >
          {dn[0]}
        </Text>
        <Text
          style={{
            fontFamily: dateTheme.pdfFontFamily ?? PDF_FONTS.serifEn,
            fontStyle: 'italic',
            fontSize: 46,
            color: dateTheme.accentColor ?? COLORS.ink2,
          }}
        >
          /
        </Text>
        <Text
          style={{
            fontFamily: dateTheme.pdfFontFamily ?? PDF_FONTS.serifEn,
            fontStyle: 'italic',
            fontSize: 46,
            color: dateTheme.accentColor ?? COLORS.ink,
          }}
        >
          {dn[1] || ''}
        </Text>
      </View>
      <PdfImage
        src={d.image}
        style={{ position: 'absolute', left: 70, top: 100, width: 360, height: 550 }}
        position={imagePos?.['image']}
      />
      {/* 左侧说明：与照片左缘对齐、宽度等于照片宽度 */}
      <View style={{ position: 'absolute', top: 670, left: 70, width: 360 }}>
        <Text style={{ position: 'absolute', left: 70, top: 670, width: 360, fontSize: 18, lineHeight: 1.7, color: COLORS.ink2, textAlign: 'justify' }}>
          {d.caption1 || ''}
        </Text>
      </View>
      {/* 右侧说明：移到照片右缘之外、收窄宽度，避免与照片重叠 */}
      <View style={{ position: 'absolute', top: 670, left: 470, width: 250 }}>
        <Text style={{ position: 'absolute', left: 470, top: 670, width: 250, fontSize: 18, lineHeight: 1.7, color: COLORS.ink2, textAlign: 'justify' }}>
          {d.caption2 || ''}
        </Text>
      </View>
      <Text
        style={{ position: 'absolute', left: 70, top: 968, width: 244, fontFamily: titleTheme.pdfFontFamily ?? PDF_FONTS.serifEn,
          fontSize: 60,
          letterSpacing: 5,
          color: titleTheme.accentColor ?? COLORS.ink }}
      >
        {titleTheme.text ?? d.title ?? 'EVENT'}
      </Text>
      {/* 标题右侧补一段长文字，填补 Event 右边的空缺 */}
      <View style={{ position: 'absolute', top: 970, left: 360, width: 360 }}>
        <Text style={{ position: 'absolute', left: 360, top: 970, width: 360, fontSize: 13, lineHeight: 1.55, color: COLORS.ink2, textAlign: 'justify' }}>
          {d.body || ''}
        </Text>
      </View>
      <PdfFolio folio={d.folio} totalPages={totalPages} fallback="08" />
    </PdfPageShell>
  );
}
