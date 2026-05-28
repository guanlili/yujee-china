import { Text, View } from '@react-pdf/renderer';
import { COLORS, PDF_FONTS } from '../constants';
import { PdfFolio, PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';

export function PdfMag07({ data, totalPages }: TemplateRenderProps) {
  const d = data as {
    imageTop?: string;
    imageMain?: string;
    caption1?: string;
    caption2?: string;
    caption3?: string;
    title?: string;
    folio?: string;
  };
  const cap = (text: string) => (
    <Text style={{ lineHeight: 1.7, color: COLORS.ink2, textAlign: 'justify', fontSize: 16 }}>
      {text}
    </Text>
  );
  const idx = (label: string) => (
    <Text style={{ fontSize: 14, letterSpacing: 4, color: COLORS.ink2, marginBottom: 8 }}>
      {label}
    </Text>
  );
  return (
    <PdfPageShell fontFamily={PDF_FONTS.sansEn}>
      <View style={{ position: 'absolute', top: 90, left: 50, width: 240 }}>
        {idx('I.')}
        {cap(d.caption1 || '')}
      </View>
      <PdfImage
        src={d.imageTop}
        style={{ position: 'absolute', top: 90, right: 50, width: 380, height: 230 }}
      />
      <View style={{ position: 'absolute', top: 360, left: 50, width: 240 }}>
        {idx('II.')}
        {cap(d.caption2 || '')}
      </View>
      <View style={{ position: 'absolute', top: 540, left: 50, width: 240 }}>
        {idx('III.')}
        {cap(d.caption3 || '')}
      </View>
      <PdfImage
        src={d.imageMain}
        style={{ position: 'absolute', top: 360, right: 50, width: 380, height: 480 }}
      />
      <Text
        style={{
          position: 'absolute',
          bottom: 70,
          left: 50,
          fontFamily: PDF_FONTS.serifEn,
          fontSize: 48,
          lineHeight: 1.15,
          color: COLORS.ink,
        }}
      >
        {d.title || 'FUSHI\nINARI'}
      </Text>
      <PdfFolio folio={d.folio} totalPages={totalPages} fallback="07" />
    </PdfPageShell>
  );
}
