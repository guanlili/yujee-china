import { COLORS, WEB_FONTS } from '../constants';
import { WebFolio, WebPage } from '../web-utils';
import type { TemplateArrayItem, TemplateRenderProps, ToCItem } from '../types';
import { resolveThemeCarrier } from '../theme-carrier';

export function WebMag02({ data, totalPages }: TemplateRenderProps) {
  const d = data as {
    title?: string | TemplateArrayItem[];
    number?: TemplateArrayItem[];
    description?: TemplateArrayItem[];
    items?: ToCItem[];
    folio?: string;
  };
  const headingTheme = resolveThemeCarrier(data, 'title');
  const folioTheme = resolveThemeCarrier(data, 'folio');
  // 顶层标题与重复项 title[i] 共享 base key `title`:有重复项时 data.title 是数组,
  // 顶层标题退回默认值。仅当 data.title 是字符串时才作为顶层大标题用。
  const headingText =
    typeof d.title === 'string' ? d.title : undefined;
  // 重复组 items 三个并列可编辑槽位 number/title/description(寻址 number[i]/title[i]/
  // description[i]);兼容旧的 items 对象数组数据
  const rawNumbers = Array.isArray(d.number) ? d.number : undefined;
  const rawTitles = Array.isArray(d.title) ? d.title : undefined;
  const rawDescriptions = Array.isArray(d.description) ? d.description : undefined;
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
    (rawNumbers?.length ?? 0) > 0 ||
    (rawTitles?.length ?? 0) > 0 ||
    (rawDescriptions?.length ?? 0) > 0 ||
    legacy.length > 0;
  const numbers = hasContent ? rawNumbers : SAMPLE_NUMBERS;
  const titles = hasContent ? rawTitles : SAMPLE_TITLES;
  const descriptions = hasContent ? rawDescriptions : SAMPLE_DESCRIPTIONS;
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
          top: 96,
          left: 56,
          fontSize: 36,
          fontWeight: 800,
          lineHeight: 1,
          letterSpacing: '0.04em',
          color: headingTheme.accentColor ?? COLORS.ink,
          fontFamily: headingTheme.webFontFamily ?? WEB_FONTS.montserrat,
        }}
      >
        {headingTheme.text ?? headingText ?? 'CONTENTS'}
      </div>
      <div
        style={{
          position: 'absolute',
          top: 338,
          left: 56,
          right: 56,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          rowGap: 96,
          columnGap: 80,
        }}
      >
        {rows.map((_, i) => {
          const numberTheme = resolveThemeCarrier(data, `number[${i}]`);
          const titleTheme = resolveThemeCarrier(data, `title[${i}]`);
          const descriptionTheme = resolveThemeCarrier(data, `description[${i}]`);
          // 把编号(如 "01")拆成前导 0(lead)与主数字(rest):前导 0 小号、上移半个字符,
          // 主数字放大,形成"0¹/"的层次。无前导 0 时 lead 为空,只显示主数字。
          const numRaw =
            slotText(numbers?.[i]) ?? legacy[i]?.n ?? String(i + 1).padStart(2, '0');
          const numMatch = /^(0*)(.*)$/.exec(numRaw) ?? ['', '', numRaw];
          const numLead = numMatch[1];
          const numRest = numMatch[2] || numRaw;
          return (
          <div key={i}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                marginBottom: 6,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-end',
                  gap: 5,
                  lineHeight: 1,
                  transform: 'skewX(-8deg)',
                  fontFamily: numberTheme.webFontFamily ?? WEB_FONTS.montserrat,
                  color: numberTheme.accentColor ?? COLORS.ink,
                }}
              >
                {numLead ? <span style={{ fontSize: 50 }}>{numLead}</span> : null}
                <span style={{ fontSize: 64 }}>{numRest}</span>
              </div>
              {/* 数字后的斜杠:字号 17(同小标题行),不加粗 */}
              <div
                style={{
                  fontSize: 17,
                  fontWeight: 400,
                  lineHeight: 1,
                  fontFamily: numberTheme.webFontFamily ?? WEB_FONTS.montserrat,
                  color: numberTheme.accentColor ?? COLORS.ink,
                }}
              >
                /
              </div>
            </div>
            <div
              style={{
                fontSize: 17,
                fontWeight: 800,
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                color: titleTheme.accentColor ?? COLORS.ink,
                marginBottom: 10,
                fontFamily: titleTheme.webFontFamily ?? WEB_FONTS.montserrat,
              }}
            >
              {slotText(titles?.[i]) ?? legacy[i]?.title ?? ''}
            </div>
            <div
              style={{
                lineHeight: 1.7,
                color: descriptionTheme.accentColor ?? COLORS.ink2,
                textAlign: 'justify',
                letterSpacing: '0.02em',
                fontSize: 16,
              }}
            >
              {slotText(descriptions?.[i]) ?? legacy[i]?.body ?? ''}
            </div>
          </div>
          );
        })}
      </div>
      <WebFolio folio={d.folio} totalPages={totalPages} accentColor={folioTheme.accentColor} fallback="02" />
    </WebPage>
  );
}
