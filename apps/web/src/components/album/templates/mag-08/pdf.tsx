import { Text, View } from '@react-pdf/renderer';
import { COLORS, PDF_FONTS } from '../constants';
import { PdfFolio, PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';
import { resolveThemeCarrier } from '../theme-carrier';


export function PdfMag08({ data, totalPages, imagePos }: TemplateRenderProps) {
  const d = data as {
    image?: string;
    date?: string;
    explain1?: string;
    explain2?: string;
    title?: string;
    folio?: string;
  };
  const dateTheme = resolveThemeCarrier(data, 'date', 'decoration');
  const titleTheme = resolveThemeCarrier(data, 'title', 'title');
  const explain1Theme = resolveThemeCarrier(data, 'explain1', 'explain');
  const explain2Theme = resolveThemeCarrier(data, 'explain2', 'explain');
  const folioTheme = resolveThemeCarrier(data, 'folio', 'decoration');
  const titleText = titleTheme.text ?? d.title ?? 'EVENT';
  const dn = (d.date || '08/24').split('/');
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
            fontFamily: dateTheme.pdfFontFamily,
            fontStyle: 'italic',
            fontSize: 46,
            color: dateTheme.accentColor ?? COLORS.ink,
          }}
        >
          {dn[0]}
        </Text>
        <Text
          style={{
            fontFamily: dateTheme.pdfFontFamily,
            fontStyle: 'italic',
            fontSize: 46,
            color: dateTheme.accentColor ?? COLORS.ink2,
          }}
        >
          /
        </Text>
        <Text
          style={{
            fontFamily: dateTheme.pdfFontFamily,
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
        <Text style={{ position: 'absolute', left: 70, top: 670, width: 360, fontFamily: explain1Theme.pdfFontFamily, fontSize: 18, lineHeight: 1.7, color: explain1Theme.accentColor ?? COLORS.ink2, textAlign: 'justify' }}>
          {d.explain1 || ''}
        </Text>
      </View>
      {/* 右侧说明：移到照片右缘之外、收窄宽度，避免与照片重叠；分两段渲染 */}
      <View style={{ position: 'absolute', top: 300, left: 470, width: 250 }}>
        {(d.explain2 || '').split('\n\n').map((para, i) => (
          <Text key={i} style={{ marginTop: i === 0 ? 0 : 14, fontFamily: explain2Theme.pdfFontFamily, fontSize: 16, lineHeight: 1.7, color: explain2Theme.accentColor ?? COLORS.ink2, textAlign: 'justify' }}>
            {para}
          </Text>
        ))}
      </View>
      <Text
        style={{ position: 'absolute', left: 70, top: 920, width: 280, fontFamily: titleTheme.pdfFontFamily,
          fontSize: 78,
          lineHeight: 1.05,
          letterSpacing: 1,
          color: titleTheme.accentColor ?? COLORS.ink }}
      >
        {titleText}
      </Text>
      <PdfFolio fontFamily={folioTheme.pdfFontFamily} folio={d.folio} totalPages={totalPages} accentColor={folioTheme.accentColor} fallback="08" />
    </PdfPageShell>
  );
}
