import { COLORS, WEB_FONTS } from '../constants';
import {WebPage} from '../web-utils';
import type { TemplateArrayItem, TemplateRenderProps, ToCItem } from '../types';
import { resolveThemeCarrier } from '../theme-carrier';
import { contractRole } from '../contract-role';

export function WebMag02({ data, totalPages }: TemplateRenderProps) {
  const d = data as {
    title?: string;                   // 顶层大标题
    title2?: TemplateArrayItem[];     // 重复组条目标题（寻址 title2[i]）
    label?: TemplateArrayItem[];      // 重复组条目编号
    explain?: TemplateArrayItem[];    // 重复组条目描述
    items?: ToCItem[];
  };
  const headingTheme = resolveThemeCarrier(data, 'title', contractRole('mag-02', 'title'));
  // 顶层标题与重复项条目标题曾共享 base key `title`（有条目时 data.title 被顶成数组，
  // 顶层标题就丢了）。槽已改名为 title / title2，两者彻底分开，这个坑不复存在。
  const headingText = d.title;
  // 重复组三个并列可编辑槽位 label/title2/explain（寻址 label[i]/title2[i]/
  // explain[i]）；兼容旧的 items 对象数组数据
  const rawNumbers = Array.isArray(d.label) ? d.label : undefined;
  const rawTitles = Array.isArray(d.title2) ? d.title2 : undefined;
  const rawDescriptions = Array.isArray(d.explain) ? d.explain : undefined;
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
          fontFamily: headingTheme.webFontFamily,
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
          const numberTheme = resolveThemeCarrier(data, `label[${i}]`, 'decoration');
          const titleTheme = resolveThemeCarrier(data, `title2[${i}]`, 'title');
          const descriptionTheme = resolveThemeCarrier(data, `explain[${i}]`, 'explain');
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
                  fontFamily: numberTheme.webFontFamily,
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
                  fontFamily: numberTheme.webFontFamily,
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
                fontFamily: titleTheme.webFontFamily,
              }}
            >
              {slotText(titles?.[i]) ?? legacy[i]?.title ?? ''}
            </div>
            <div
              style={{
                lineHeight: 1.7,
                color: descriptionTheme.accentColor ?? COLORS.ink2,
                fontFamily: descriptionTheme.webFontFamily,
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
      </div></WebPage>
  );
}
