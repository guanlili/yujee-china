import { Text, View } from '@react-pdf/renderer';
import { COLORS, PDF_FONTS } from '../constants';
import { PdfFolio, PdfPageShell } from '../pdf-utils';
import type { TemplateArrayItem, TemplateRenderProps, ToCItem } from '../types';
import { resolveThemeCarrier } from '../theme-carrier';

// 文字含中文时切到 serifCn(Noto SC)避免豆腐块,纯英文走 montserrat(与 web 一致)。
const hasCjk = (s: string | undefined) => /[一-鿿]/.test(s || '');

export function PdfMag02({ data, totalPages }: TemplateRenderProps) {
  const d = data as {
    title?: string | TemplateArrayItem[];
    number?: TemplateArrayItem[];
    description?: TemplateArrayItem[];
    items?: ToCItem[];
    folio?: string;
  };
  const headingTheme = resolveThemeCarrier(data, 'title');
  // 顶层标题与重复项 title[i] 共享 base key `title`:有重复项时 data.title 是数组,
  // 顶层标题退回默认值。仅当 data.title 是字符串时才作为顶层大标题用。
  const headingText = typeof d.title === 'string' ? d.title : undefined;
  // 重复组 items 三个并列可编辑槽位 number/title/description(寻址 number[i]/title[i]/
  // description[i]);兼容旧的 items 对象数组数据
  const rawNumbers = Array.isArray(d.number) ? d.number : undefined;
  const rawTitles = Array.isArray(d.title) ? d.title : undefined;
  const rawDescriptions = Array.isArray(d.description) ? d.description : undefined;
  const legacy = d.items ?? [];
  // 真实相册数据里,repeat 文字槽经 adapt-layout 会被包成 {body, caption} 对象
  // (SAMPLE_*/legacy 仍是纯字符串)。两种形状都取成字符串,绝不把对象塞进渲染节点。
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
  const headingResolved = headingTheme.text ?? headingText ?? 'CONTENTS';
  // 四个小标题共用同一份主题(取 title[0])与同一字体:只要任一标题含中文就整体
  // 切到 serifCn,保证四个小标题的字号/字体/颜色等设置完全统一。
  const titleTheme = resolveThemeCarrier(data, 'title[0]');
  const anyTitleCjk = rows.some((_, i) =>
    hasCjk(slotText(titles?.[i]) || legacy[i]?.title || ''),
  );
  const titleFontFamily =
    titleTheme.pdfFontFamily ?? (anyTitleCjk ? PDF_FONTS.serifCn : PDF_FONTS.montserrat);
  return (
    <PdfPageShell fontFamily={PDF_FONTS.sansEn}>
      <Text
        style={{
          position: 'absolute',
          top: 96,
          left: 56,
          fontSize: 36,
          fontWeight: 800,
          lineHeight: 1,
          letterSpacing: 3,
          color: headingTheme.accentColor ?? COLORS.ink,
          fontFamily:
            headingTheme.pdfFontFamily ??
            (hasCjk(headingResolved) ? PDF_FONTS.serifCn : PDF_FONTS.montserrat),
        }}
      >
        {headingResolved}
      </Text>
      {rows.map((_, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const x = 56 + col * (cellW + 80);
        const y = 338 + row * 360;
        const numberTheme = resolveThemeCarrier(data, `number[${i}]`);
        const titleResolved = slotText(titles?.[i]) || legacy[i]?.title || '';
        // 把编号(如 "01")拆成前导 0(lead)与主数字(rest):前导 0 小号、上移半个字符,
        // 主数字放大,形成"0¹/"的层次。无前导 0 时 lead 为空,只显示主数字。
        const numRaw =
          slotText(numbers?.[i]) || legacy[i]?.n || String(i + 1).padStart(2, '0');
        const numMatch = /^(0*)(.*)$/.exec(numRaw) ?? ['', '', numRaw];
        const numLead = numMatch[1];
        const numRest = numMatch[2] || numRaw;
        return (
          <View key={i} style={{ position: 'absolute', top: y, left: x, width: cellW }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                marginBottom: 6,
              }}
            >
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'flex-end',
                  transform: 'skewX(-8deg)',
                }}
              >
                {numLead ? (
                  <Text
                    style={{
                      fontSize: 50,
                      marginRight: 5,
                      fontFamily: numberTheme.pdfFontFamily ?? PDF_FONTS.montserrat,
                      color: numberTheme.accentColor ?? COLORS.ink,
                    }}
                  >
                    {numLead}
                  </Text>
                ) : null}
                <Text
                  style={{
                    fontSize: 64,
                    fontFamily: numberTheme.pdfFontFamily ?? PDF_FONTS.montserrat,
                    color: numberTheme.accentColor ?? COLORS.ink,
                  }}
                >
                  {numRest}
                </Text>
              </View>
              {/* 数字后的斜杠:字号 17(同小标题行),不加粗 */}
              <Text
                style={{
                  fontSize: 17,
                  fontWeight: 400,
                  marginLeft: 12,
                  fontFamily: numberTheme.pdfFontFamily ?? PDF_FONTS.montserrat,
                  color: numberTheme.accentColor ?? COLORS.ink,
                }}
              >
                /
              </Text>
            </View>
            <Text
              style={{
                fontSize: 17,
                fontWeight: 800,
                letterSpacing: 2.25,
                color: titleTheme.accentColor ?? COLORS.ink,
                marginBottom: 10,
                textTransform: 'uppercase',
                fontFamily: titleFontFamily,
              }}
            >
              {titleResolved}
            </Text>
            <Text
              style={{
                lineHeight: 1.7,
                color: COLORS.ink2,
                textAlign: 'justify',
                fontSize: 16,
              }}
            >
              {slotText(descriptions?.[i]) || legacy[i]?.body || ''}
            </Text>
          </View>
        );
      })}
      <PdfFolio folio={d.folio} totalPages={totalPages} fallback="02" />
    </PdfPageShell>
  );
}
