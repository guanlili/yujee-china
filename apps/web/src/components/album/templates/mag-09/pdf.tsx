import { Text, View } from '@react-pdf/renderer';
import { COLORS, PDF_FONTS } from '../constants';
import { PdfFolio, PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';
import { resolveThemeCarrier } from '../theme-carrier';

// 主标题用 Bebas Neue（高瘦大写艺术字）；含中文切 serifCn（Noto SC）避免豆腐块，与 web 一致。

export function PdfMag09({ data, totalPages, imagePos }: TemplateRenderProps) {
  const d = data as {
    image1?: string;
    image2?: string;
    body?: string;
    title?: string;
    explain1?: string;
    explain2?: string;
    explain3?: string;
    folio?: string;
  };
  const titleTheme = resolveThemeCarrier(data, 'title', 'title');
  const bodyTheme = resolveThemeCarrier(data, 'body', 'body');
  const explain1Theme = resolveThemeCarrier(data, 'explain1', 'explain');
  const explain2Theme = resolveThemeCarrier(data, 'explain2', 'explain');
  const explain3Theme = resolveThemeCarrier(data, 'explain3', 'explain');
  const folioTheme = resolveThemeCarrier(data, 'folio', 'decoration');
  return (
    <PdfPageShell fontFamily={PDF_FONTS.sansEn}>
      <PdfImage
        src={d.image1}
        style={{ position: 'absolute', left: 50, top: 90, width: 300, height: 300 }}
        position={imagePos?.['image1']}
      />
      <View style={{ position: 'absolute', top: 130, right: 60, width: 230 }}>
        <Text
          style={{ position: 'absolute', left: 504, top: 130, width: 230, lineHeight: 1.7,
            fontFamily: bodyTheme.pdfFontFamily,
            color: bodyTheme.accentColor ?? COLORS.ink2,
            textAlign: 'justify',
            fontSize: 18 }}
        >
          {d.body || ''}
        </Text>
      </View>
      <Text
        style={{ position: 'absolute', left: 60, top: 396, width: 300,
          fontFamily: titleTheme.pdfFontFamily,
          fontSize: 116,
          letterSpacing: 2,
          lineHeight: 0.92,
          color: titleTheme.accentColor ?? COLORS.ink }}
      >
        {titleTheme.text ?? d.title ?? 'OSAKA\nJAPAN'}
      </Text>
      <PdfImage
        src={d.image2}
        style={{ position: 'absolute', left: 374, top: 400, width: 370, height: 600 }}
        position={imagePos?.['image2']}
      />
      <View style={{ position: 'absolute', top: 620, left: 60, width: 280 }}>
        <Text style={{ position: 'absolute', left: 60, top: 620, width: 280, fontFamily: explain1Theme.pdfFontFamily, lineHeight: 1.75, color: explain1Theme.accentColor ?? COLORS.ink2, textAlign: 'justify', fontSize: 18 }}>
          {d.explain1 || ''}
        </Text>
        <Text style={{ position: 'absolute', left: 60, top: 664, width: 280, fontFamily: explain2Theme.pdfFontFamily, lineHeight: 1.75, color: explain2Theme.accentColor ?? COLORS.ink2, textAlign: 'justify', fontSize: 18 }}>
          {d.explain2 || ''}
        </Text>
        <Text style={{ marginTop: 12, fontFamily: explain3Theme.pdfFontFamily, lineHeight: 1.6, color: explain3Theme.accentColor ?? COLORS.ink2, textAlign: 'justify', fontSize: 13 }}>
          {d.explain3 || ''}
        </Text>
      </View>
      <PdfFolio fontFamily={folioTheme.pdfFontFamily} folio={d.folio} totalPages={totalPages} accentColor={folioTheme.accentColor} fallback="09" />
    </PdfPageShell>
  );
}
