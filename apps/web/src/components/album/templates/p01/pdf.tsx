import { Text, View } from '@react-pdf/renderer';
import { COLORS, PDF_FONTS } from '../constants';
import { PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';
import { resolveThemeCarrier } from '../theme-carrier';

const hasCjk = (s?: string) => /[一-鿿]/.test(s || '');

export function PdfP01({ data, imagePos }: TemplateRenderProps) {
  const d = data as {
    image?: string;
    title?: string;
    body?: string;
    label1?: string;
    label1Color?: string;
    label2?: string;
    date?: string;
  };
  const titleTheme = resolveThemeCarrier(data, 'title');
  const categoryTheme = resolveThemeCarrier(data, 'label1');
  const volTheme = resolveThemeCarrier(data, 'label2');
  const dateTheme = resolveThemeCarrier(data, 'date');
  // PDF 不支持 mixBlendMode,顶部白文字直接半透明渲染,深色背景下仍可读。
  return (
    <PdfPageShell dark fontFamily={PDF_FONTS.serifCn}>
      <PdfImage
        src={d.image}
        style={{ position: 'absolute', top: 0, bottom: 320, left: 0, width: 794 }}
        position={imagePos?.['image']}
      />
      <View
        style={{
          position: 'absolute',
          top: 36,
          left: 56,
          right: 56,
          flexDirection: 'row',
          justifyContent: 'space-between',
        }}
      >
        <Text
          style={{
            fontFamily: PDF_FONTS.mono,
            letterSpacing: 4,
            color: '#ffffff',
            fontSize: 14,
          }}
        >
          VOL.{' '}
          <Text
            style={{
              color: volTheme.accentColor,
              fontFamily: volTheme.pdfFontFamily,
            }}
          >
            {volTheme.text ?? d.label2 ?? '01'}
          </Text>{' '}
          ·{' '}
          <Text
            style={{
              color: dateTheme.accentColor,
              fontFamily: dateTheme.pdfFontFamily,
            }}
          >
            {dateTheme.text ?? d.date ?? '2026'}
          </Text>
        </Text>
        <Text
          style={{
            fontFamily: PDF_FONTS.mono,
            letterSpacing: 4,
            color: '#ffffff',
            fontSize: 14,
          }}
        >
          MEMOIR
        </Text>
      </View>
      <Text
        style={{
          position: 'absolute',
          top: 70,
          right: 56,
          fontFamily: volTheme.pdfFontFamily ?? PDF_FONTS.playfair,
          fontStyle: 'italic',
          fontSize: 100,
          color: volTheme.accentColor ?? '#ffffff',
        }}
      >
        {volTheme.text ?? d.label2 ?? '01'}
      </Text>
      <View
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 320,
          backgroundColor: COLORS.ink,
          paddingTop: 40,
          paddingLeft: 56,
          paddingRight: 56,
        }}
      >
        <Text
          style={{
            fontFamily: categoryTheme.pdfFontFamily ?? PDF_FONTS.playfair,
            fontStyle: 'italic',
            color: categoryTheme.accentColor ?? d.label1Color ?? COLORS.vermilionSoft,
            fontSize: 16,
          }}
        >
          {categoryTheme.text ?? d.label1 ?? 'no 01 · Portrait'}
        </Text>
        <Text
          style={{
            marginTop: 8,
            fontFamily:
              titleTheme.pdfFontFamily ?? (hasCjk(titleTheme.text ?? d.title) ? PDF_FONTS.serifCn : PDF_FONTS.playfair),
            lineHeight: 1.15,
            color: titleTheme.accentColor ?? COLORS.paper,
            fontSize: 56,
          }}
        >
          {titleTheme.text ?? d.title ?? 'Page Title'}
        </Text>
        <Text
          style={{
            marginTop: 22,
            fontFamily: hasCjk(d.body) ? PDF_FONTS.serifCn : PDF_FONTS.lora,
            lineHeight: 1.85,
            color: COLORS.paper78,
            textAlign: 'justify',
            fontSize: 18,
          }}
        >
          {d.body || ''}
        </Text>
      </View>
    </PdfPageShell>
  );
}
