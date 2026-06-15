import { COLORS, WEB_FONTS } from '../constants';
import { WebFolio, WebPage } from '../web-utils';
import type { TemplateRenderProps, ToCItem } from '../types';

export function WebMag02({ data, totalPages }: TemplateRenderProps) {
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
  const count = Math.max(
    numbers?.length ?? 0,
    titles?.length ?? 0,
    descriptions?.length ?? 0,
    legacy.length,
    1,
  );
  const rows = Array.from({ length: count });
  return (
    <WebPage fontFamily={WEB_FONTS.sansEn}>
      <div style={{ position: 'absolute', top: 110, left: 56, fontSize: 25, letterSpacing: '0.36em' }}>
        {d.heading ?? 'CONTENTS'}
      </div>
      <div
        style={{
          position: 'absolute',
          top: 240,
          left: 56,
          right: 56,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          rowGap: 100,
          columnGap: 80,
        }}
      >
        {rows.map((_, i) => (
          <div key={i}>
            <div
              style={{
                fontSize: 44,
                fontFamily: WEB_FONTS.serifEn,
                fontStyle: 'italic',
                color: COLORS.ink,
                marginBottom: 6,
              }}
            >
              {numbers?.[i] ?? legacy[i]?.n ?? String(i + 1).padStart(2, '0')}
            </div>
            <div
              style={{
                fontSize: 15,
                letterSpacing: '0.32em',
                textTransform: 'uppercase',
                color: COLORS.ink2,
                marginBottom: 10,
              }}
            >
              {titles?.[i] ?? legacy[i]?.title ?? ''}
            </div>
            <div
              style={{
                lineHeight: 1.85,
                color: COLORS.ink2,
                textAlign: 'justify',
                letterSpacing: '0.02em',
                fontSize: 20,
              }}
            >
              {descriptions?.[i] ?? legacy[i]?.body ?? ''}
            </div>
          </div>
        ))}
      </div>
      <WebFolio folio={d.folio} totalPages={totalPages} fallback="02" />
    </WebPage>
  );
}
