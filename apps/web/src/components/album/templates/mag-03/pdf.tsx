import { Text, View } from '@react-pdf/renderer';
import { COLORS, PDF_FONTS } from '../constants';
import { PdfFolio, PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';
import { resolveThemeCarrier } from '../theme-carrier';

// @react-pdf 无逐字回退：标签默认 Montserrat（与 web 一致），含中文则切 serifCn(Noto SC) 避免豆腐块。
const hasCjk = (s: string | undefined) => /[一-鿿]/.test(s || '');

export function PdfMag03({ data, totalPages, imagePos }: TemplateRenderProps) {
  const d = data as {
    label?: string;
    date?: string;
    folio?: string;
    image?: string;
  };
  const labelTheme = resolveThemeCarrier(data, 'label');
  const labelText = labelTheme.text ?? d.label ?? '';
  const labelFont =
    labelTheme.pdfFontFamily ?? (hasCjk(labelText) ? PDF_FONTS.serifCn : PDF_FONTS.montserrat);
  const dateText = d.date ?? '';
  const dateFont = hasCjk(dateText) ? PDF_FONTS.serifCn : PDF_FONTS.montserrat;
  // 装饰：与标签同色（参与主题换肤）的四角框线，压在图片之上（与 web 一致）。
  const decorColor = labelTheme.accentColor ?? COLORS.ink;
  const corners = [
    { top: 94, left: 64, sides: ['Top', 'Left'] },
    { top: 94, left: 702, sides: ['Top', 'Right'] },
    { top: 963, left: 64, sides: ['Bottom', 'Left'] },
    { top: 963, left: 702, sides: ['Bottom', 'Right'] },
  ] as const;
  return (
    <PdfPageShell fontFamily={PDF_FONTS.sansEn}>
      <PdfImage
        src={d.image}
        style={{ position: 'absolute', top: 80, left: 50, right: 50, height: 925 }}
        position={imagePos?.['image']}
      />
      {corners.map((c, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            top: c.top,
            left: c.left,
            width: 30,
            height: 30,
            ...Object.fromEntries(
              c.sides.flatMap((s) => [
                [`border${s}Width`, 2],
                [`border${s}Color`, decorColor],
              ]),
            ),
          }}
        />
      ))}
      <View style={{ position: 'absolute', bottom: 50, left: 50, right: 50 }}>
        <Text
          style={{
            // 小标签(京都 ·):字号砍半(30→15),日期上方的小字 kicker,与 web 一致(中文回退 serifCn)。
            letterSpacing: 5,
            color: labelTheme.accentColor ?? COLORS.ink,
            textTransform: 'uppercase',
            fontSize: 15,
            fontWeight: 600,
            fontFamily: labelFont,
          }}
        >
          {labelText}
        </Text>
        {dateText ? (
          <Text
            style={{
              // 日期(03 / 30):字号 30,下方较大的一部分,与 web 一致。
              marginTop: 6,
              letterSpacing: 2,
              color: labelTheme.accentColor ?? COLORS.ink,
              fontSize: 30,
              fontWeight: 600,
              fontFamily: dateFont,
            }}
          >
            {dateText}
          </Text>
        ) : null}
      </View>
      <PdfFolio folio={d.folio} totalPages={totalPages} fallback="03" />
    </PdfPageShell>
  );
}
