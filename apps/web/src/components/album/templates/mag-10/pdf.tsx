import { Text, View } from '@react-pdf/renderer';
import { COLORS, PDF_FONTS } from '../constants';
import { PdfFolio, PdfImage, PdfPageShell } from '../pdf-utils';
import type { GridCell, TemplateData, TemplateRenderProps } from '../types';
import { resolveThemeCarrier } from '../theme-carrier';

// 重复组 items:image 寻址 image[i]、图说文字寻址 explain[i]。adapt-layout 把
// image[i]/explain[i] 还原成 data.image / data.explain 两个并列数组(元素为
// 字符串或 {body,caption} 对象)。
// 图注含中文时切到 serifCn（Noto SC）避免豆腐块，纯英文走 Montserrat（与 web 一致）。
const hasCjk = (s: string | undefined) => /[一-鿿]/.test(s || '');

function cellText(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') {
    const o = v as { body?: string; caption?: string };
    return o.body ?? o.caption ?? '';
  }
  return String(v);
}

export function PdfMag10({ data, totalPages, imagePos }: TemplateRenderProps) {
  const d = data as TemplateData & {
    cells?: GridCell[];
    image?: unknown[];
    explain?: unknown[];
    folio?: string;
  };
  const images = Array.isArray(d.image) ? d.image : undefined;
  const explains = Array.isArray(d.explain) ? d.explain : undefined;
  const count = Math.min(
    4,
    Math.max(images?.length ?? 0, explains?.length ?? 0, d.cells?.length ?? 0, 4),
  );
  const merged = Array.from({ length: count }).map((_, i) => {
    const legacy = d.cells?.[i];
    return {
      n: legacy?.n ?? String(i + 9),
      image:
        cellText(images?.[i]) ||
        legacy?.image ||
        (d[`image[${i}]`] as string | undefined) ||
        '',
      caption: cellText(explains?.[i]) || legacy?.caption || '',
    };
  });
  const cellW = (794 - 60 * 2 - 50) / 2;
  const folioTheme = resolveThemeCarrier(data, 'folio');
  return (
    <PdfPageShell fontFamily={PDF_FONTS.sansEn}>
      {merged.map((c, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const x = 60 + col * (cellW + 50);
        const y = 130 + row * (28 + 280 + 12 + 80);
        const cellTheme = resolveThemeCarrier(data, `explain[${i}]`);
        return (
          <View key={c.n ?? i} style={{ position: 'absolute', top: y, left: x, width: cellW }}>
            <Text
              style={{
                fontFamily: PDF_FONTS.serifEn,
                fontSize: 22,
                color: COLORS.ink,
                marginBottom: 12,
              }}
            >
              {i + 1}
            </Text>
            <PdfImage src={c.image} style={{ width: cellW, height: 280 }} position={imagePos?.[`image[${i}]`]} />
            <Text
              style={{
                marginTop: 12,
                fontFamily: hasCjk(c.caption) ? PDF_FONTS.serifCn : PDF_FONTS.montserrat,
                lineHeight: 1.7,
                letterSpacing: 0.5,
                color: cellTheme.accentColor ?? COLORS.ink,
                textAlign: 'justify',
                fontSize: 13,
              }}
            >
              {c.caption || ''}
            </Text>
          </View>
        );
      })}
      <PdfFolio folio={d.folio} totalPages={totalPages} accentColor={folioTheme.accentColor} fallback="10" />
    </PdfPageShell>
  );
}
