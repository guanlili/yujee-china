import { Text, View } from '@react-pdf/renderer';
import { COLORS, PDF_FONTS } from '../constants';
import { PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';
import { resolveThemeCarrier } from '../theme-carrier';

const hasCjk = (s?: string) => /[一-鿿]/.test(s || '');

export function PdfMag01({ data, imagePos }: TemplateRenderProps) {
  const d = data as {
    title?: string;
    label?: string;
    explain1?: string;
    explain2?: string;
    folio?: string;
    image?: string;
  };
  const headingTheme = resolveThemeCarrier(data, 'title');
  const sideTextTheme = resolveThemeCarrier(data, 'label');
  const explain1Theme = resolveThemeCarrier(data, 'explain1');
  const explain2Theme = resolveThemeCarrier(data, 'explain2');
  const titleText = headingTheme.text ?? d.title ?? 'VENUES';
  const titleFont = hasCjk(titleText) ? PDF_FONTS.serifCn : PDF_FONTS.playfair;
  return (
    <PdfPageShell fontFamily={PDF_FONTS.sansEn}>
      <View
        style={{
          position: 'absolute',
          top: 140,
          left: 130,
          right: 130,
          flexDirection: 'row',
          alignItems: 'center',
        }}
      >
        <Text
          style={{
            letterSpacing: 2.9,
            fontSize: 72,
            fontWeight: 700,
            lineHeight: 1,
            color: headingTheme.accentColor ?? COLORS.ink,
            fontFamily: titleFont,
          }}
        >
          {titleText}
        </Text>
        <View style={{ flexGrow: 1, height: 3, backgroundColor: COLORS.ink, marginHorizontal: 16 }} />
        <View
          style={{
            width: 26,
            height: 26,
            borderRadius: 13,
            borderWidth: 1,
            borderColor: COLORS.ink,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontFamily: PDF_FONTS.mono, fontSize: 16, color: COLORS.ink }}>N</Text>
        </View>
      </View>
      {/* @react-pdf 不支持 writingMode:vertical-rl,且断字回调把拉丁串当整体不换行,
          直接给 width:14 会横向溢出压到右侧图片(web 端竖排正常)。逐字符插换行,
          手动竖排,与 web 的 vertical-rl 外观对齐。 */}
      <Text
        style={{
          position: 'absolute',
          top: 280,
          left: 56,
          color: sideTextTheme.accentColor ?? COLORS.ink2,
          fontSize: 17,
          fontFamily: sideTextTheme.pdfFontFamily,
          textTransform: 'uppercase',
          textAlign: 'center',
          lineHeight: 1.05,
          width: 17,
        }}
      >
        {(sideTextTheme.text ?? d.label ?? '').split('').join('\n')}
      </Text>
      <PdfImage
        src={d.image}
        style={{ position: 'absolute', top: 240, right: 0, width: 660, height: 460 }}
        position={imagePos?.['image']}
      />
      <Text
        style={{
          position: 'absolute',
          left: 130,
          top: 720,
          lineHeight: 1.7,
          color: explain1Theme.accentColor ?? COLORS.ink2,
          fontSize: 18,
          width: 360,
        }}
      >
        {d.explain1 || ''}
      </Text>
      <Text
        style={{
          position: 'absolute',
          left: 130,
          top: 840,
          lineHeight: 1.7,
          color: explain2Theme.accentColor ?? COLORS.ink2,
          textAlign: 'justify',
          fontSize: 18,
          width: 360,
        }}
      >
        {d.explain2 || ''}
      </Text>
    </PdfPageShell>
  );
}
