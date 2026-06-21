import { Text, View } from '@react-pdf/renderer';
import { COLORS, PDF_FONTS } from '../constants';
import { PdfFolio, PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';
import { resolveThemeCarrier } from '../theme-carrier';

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
  const titleTheme = resolveThemeCarrier(data, 'title');
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
            color: COLORS.ink2,
            textAlign: 'justify',
            fontSize: 18 }}
        >
          {d.body || ''}
        </Text>
      </View>
      <Text
        style={{ position: 'absolute', left: 60, top: 392, width: 251, fontFamily: titleTheme.pdfFontFamily ?? PDF_FONTS.serifEn,
          fontSize: 64,
          letterSpacing: 4,
          lineHeight: 1.05,
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
        <Text style={{ position: 'absolute', left: 60, top: 620, width: 280, lineHeight: 1.75, color: COLORS.ink2, textAlign: 'justify', fontSize: 18 }}>
          {d.explain1 || ''}
        </Text>
        <Text style={{ position: 'absolute', left: 60, top: 664, width: 280, lineHeight: 1.75, color: COLORS.ink2, textAlign: 'justify', fontSize: 18 }}>
          {d.explain2 || ''}
        </Text>
        <Text style={{ marginTop: 12, lineHeight: 1.75, color: COLORS.ink2, textAlign: 'justify', fontSize: 18 }}>
          {d.explain3 || ''}
        </Text>
      </View>
      <PdfFolio folio={d.folio} totalPages={totalPages} fallback="09" />
    </PdfPageShell>
  );
}
