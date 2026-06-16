import { Text, View } from '@react-pdf/renderer';
import { COLORS, PDF_FONTS } from '../constants';
import { PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';

export function PdfP01({ data }: TemplateRenderProps) {
  const d = data as {
    image?: string;
    title?: string;
    body?: string;
    category?: string;
    categoryColor?: string;
    vol?: string;
    date?: string;
  };
  // PDF 不支持 mixBlendMode,顶部白文字直接半透明渲染,深色背景下仍可读。
  return (
    <PdfPageShell dark fontFamily={PDF_FONTS.serifCn}>
      <PdfImage
        src={d.image}
        style={{ position: 'absolute', top: 0, bottom: 320, left: 0, width: 794 }}
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
          {`VOL. ${d.vol || '01'} · ${d.date || '2026'}`}
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
          fontFamily: PDF_FONTS.serifEn,
          fontStyle: 'italic',
          fontSize: 100,
          color: '#ffffff',
        }}
      >
        {d.vol || '01'}
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
            fontFamily: PDF_FONTS.serifEn,
            fontStyle: 'italic',
            color: d.categoryColor || COLORS.vermilionSoft,
            fontSize: 16,
          }}
        >
          {d.category || 'no 01 · Portrait'}
        </Text>
        <Text
          style={{
            marginTop: 8,
            fontFamily: PDF_FONTS.serifCn,
            lineHeight: 1.15,
            color: COLORS.paper,
            fontSize: 46,
          }}
        >
          {d.title || '页面标题'}
        </Text>
        <Text
          style={{
            marginTop: 22,
            fontFamily: PDF_FONTS.serifCn,
            lineHeight: 1.85,
            color: COLORS.paper78,
            textAlign: 'justify',
            fontSize: 16,
          }}
        >
          {d.body || ''}
        </Text>
      </View>
    </PdfPageShell>
  );
}
