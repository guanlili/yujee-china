import { Text, View } from '@react-pdf/renderer';
import { COLORS, PDF_FONTS } from '../constants';
import { PdfFolio, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps, ToCItem } from '../types';

export function PdfMag02({ data, totalPages }: TemplateRenderProps) {
  const d = data as {
    heading?: string;
    numbers?: string[];
    titles?: string[];
    descriptions?: string[];
    items?: ToCItem[];
    folio?: string;
  };
  // 三个并列可编辑槽位 numbers/titles/descriptions;兼容旧的 items 对象数组数据
  const legacy = d.items ?? [];
  // 预览样例:无数据时填充示意目录,避免页面看着空白
  const SAMPLE_NUMBERS = ['01', '02', '03', '04'];
  const SAMPLE_TITLES = ['Beginnings', 'Everyday Light', 'Together', 'Looking Back'];
  const SAMPLE_DESCRIPTIONS = [
    'The first quiet mornings, and where this whole story started to take shape.',
    'Small ordinary moments — a kitchen, a window, the warmth of an afternoon.',
    'The faces and hands we held close through every season of this year.',
    'A gentle pause to gather what mattered most before turning the page.',
  ];
  const hasContent =
    (d.numbers?.length ?? 0) > 0 ||
    (d.titles?.length ?? 0) > 0 ||
    (d.descriptions?.length ?? 0) > 0 ||
    legacy.length > 0;
  const numbers = hasContent ? d.numbers : SAMPLE_NUMBERS;
  const titles = hasContent ? d.titles : SAMPLE_TITLES;
  const descriptions = hasContent ? d.descriptions : SAMPLE_DESCRIPTIONS;
  const count = Math.min(
    4,
    Math.max(
      numbers?.length ?? 0,
      titles?.length ?? 0,
      descriptions?.length ?? 0,
      legacy.length,
      1,
    ),
  );
  const rows = Array.from({ length: count });
  // 4 项 2×2,简单 absolute 网格
  const cellW = (794 - 56 * 2 - 80) / 2;
  return (
    <PdfPageShell fontFamily={PDF_FONTS.sansEn}>
      <Text
        style={{
          position: 'absolute',
          top: 110,
          left: 56,
          fontSize: 25,
          letterSpacing: 6,
          color: COLORS.ink,
        }}
      >
        {d.heading ?? 'CONTENTS'}
      </Text>
      {rows.map((_, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const x = 56 + col * (cellW + 80);
        const y = 240 + row * 360;
        return (
          <View key={i} style={{ position: 'absolute', top: y, left: x, width: cellW }}>
            <Text
              style={{
                fontSize: 44,
                fontFamily: PDF_FONTS.serifEn,
                fontStyle: 'italic',
                color: COLORS.ink,
                marginBottom: 6,
              }}
            >
              {numbers?.[i] || legacy[i]?.n || String(i + 1).padStart(2, '0')}
            </Text>
            <Text
              style={{
                fontSize: 15,
                letterSpacing: 5,
                color: COLORS.ink2,
                marginBottom: 10,
                textTransform: 'uppercase',
              }}
            >
              {titles?.[i] || legacy[i]?.title || ''}
            </Text>
            <Text
              style={{
                lineHeight: 1.85,
                color: COLORS.ink2,
                textAlign: 'justify',
                fontSize: 20,
              }}
            >
              {descriptions?.[i] || legacy[i]?.body || ''}
            </Text>
          </View>
        );
      })}
      <PdfFolio folio={d.folio} totalPages={totalPages} fallback="02" />
    </PdfPageShell>
  );
}
