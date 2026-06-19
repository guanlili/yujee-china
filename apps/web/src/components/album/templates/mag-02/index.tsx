import { COLORS, WEB_FONTS } from '../constants';
import { WebFolio, WebPage } from '../web-utils';
import type { TemplateRenderProps, ToCItem } from '../types';
import { resolveThemeCarrier } from '../theme-carrier';

export function WebMag02({ data, totalPages }: TemplateRenderProps) {
  const d = data as {
    heading?: string;
    numbers?: string[];
    titles?: string[];
    descriptions?: string[];
    items?: ToCItem[];
    folio?: string;
  };
  const headingTheme = resolveThemeCarrier(data, 'heading');
  // 三个并列可编辑槽位 numbers/titles/descriptions;兼容旧的 items 对象数组数据
  const legacy = d.items ?? [];
  // 真实相册数据里,repeat 文字槽经 adapt-layout 会被包成 {body, caption} 对象
  // (SAMPLE_*/legacy 仍是纯字符串)。两种形状都取成字符串,绝不把对象塞进 JSX
  // 子节点(否则 React error #31 整页白屏)。槽位缺失时返回 undefined,保留 ?? 兜底。
  const slotText = (v: unknown): string | undefined => {
    if (v == null) return undefined;
    if (typeof v === 'string') return v;
    if (typeof v === 'object') {
      const o = v as { body?: string; caption?: string };
      return o.body ?? o.caption ?? undefined;
    }
    return String(v);
  };
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
      <div
        style={{
          position: 'absolute',
          top: 110,
          left: 56,
          fontSize: 25,
          letterSpacing: '0.36em',
          color: headingTheme.accentColor,
          fontFamily: headingTheme.webFontFamily,
        }}
      >
        {headingTheme.text ?? d.heading ?? 'CONTENTS'}
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
        {rows.map((_, i) => {
          const numberTheme = resolveThemeCarrier(data, `numbers[${i}]`);
          const titleTheme = resolveThemeCarrier(data, `titles[${i}]`);
          return (
          <div key={i}>
            <div
              style={{
                fontSize: 44,
                fontFamily: numberTheme.webFontFamily ?? WEB_FONTS.serifEn,
                fontStyle: 'italic',
                color: numberTheme.accentColor ?? COLORS.ink,
                marginBottom: 6,
              }}
            >
              {slotText(numbers?.[i]) ?? legacy[i]?.n ?? String(i + 1).padStart(2, '0')}
            </div>
            <div
              style={{
                fontSize: 15,
                letterSpacing: '0.32em',
                textTransform: 'uppercase',
                color: titleTheme.accentColor ?? COLORS.ink2,
                marginBottom: 10,
                fontFamily: titleTheme.webFontFamily,
              }}
            >
              {slotText(titles?.[i]) ?? legacy[i]?.title ?? ''}
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
              {slotText(descriptions?.[i]) ?? legacy[i]?.body ?? ''}
            </div>
          </div>
          );
        })}
      </div>
      <WebFolio folio={d.folio} totalPages={totalPages} fallback="02" />
    </WebPage>
  );
}
