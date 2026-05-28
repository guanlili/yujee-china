import { Text, View } from '@react-pdf/renderer';
import { COLORS, PDF_FONTS } from '../constants';
import { PdfFolio, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps, ToCItem } from '../types';

export function PdfMag02({ data, totalPages }: TemplateRenderProps) {
  const d = data as { items?: ToCItem[]; folio?: string };
  const items = d.items ?? [{ n: '1', title: 'Title', body: 'Description' }];
  // 4 项 2×2,简单 absolute 网格
  const cellW = (794 - 56 * 2 - 80) / 2;
  return (
    <PdfPageShell fontFamily={PDF_FONTS.sansEn}>
      <Text
        style={{
          position: 'absolute',
          top: 110,
          left: 56,
          fontSize: 16,
          letterSpacing: 6,
          color: COLORS.ink,
        }}
      >
        CONTENT
      </Text>
      {items.slice(0, 4).map((it, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const x = 56 + col * (cellW + 80);
        const y = 180 + row * 280;
        return (
          <View key={it.n ?? i} style={{ position: 'absolute', top: y, left: x, width: cellW }}>
            <Text
              style={{
                fontSize: 36,
                fontFamily: PDF_FONTS.serifEn,
                fontStyle: 'italic',
                color: COLORS.ink,
                marginBottom: 6,
              }}
            >
              {it.n || ''}
            </Text>
            <Text
              style={{
                fontSize: 13.5,
                letterSpacing: 5,
                color: COLORS.ink2,
                marginBottom: 10,
                textTransform: 'uppercase',
              }}
            >
              {it.title || ''}
            </Text>
            <Text
              style={{
                lineHeight: 1.85,
                color: COLORS.ink2,
                textAlign: 'justify',
                fontSize: 16,
              }}
            >
              {it.body || ''}
            </Text>
          </View>
        );
      })}
      <PdfFolio folio={d.folio} totalPages={totalPages} fallback="02" />
    </PdfPageShell>
  );
}
