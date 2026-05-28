import type { ReactNode } from 'react';
import { Image, Page, Text, View } from '@react-pdf/renderer';
import { COLORS, PAGE, PDF_FONTS } from './constants';

// @react-pdf/types 不直接装,Style 用宽松类型避免类型链问题。
export type PdfStyle = Record<string, string | number | undefined>;

interface PdfPageProps {
  children: ReactNode;
  dark?: boolean;
  fontFamily?: string;
}

export function PdfPageShell({ children, dark, fontFamily }: PdfPageProps) {
  return (
    <Page
      size={[PAGE.width, PAGE.height]}
      style={{
        position: 'relative',
        backgroundColor: dark ? COLORS.ink : COLORS.paper,
        color: dark ? COLORS.paper : COLORS.ink,
        fontFamily: fontFamily ?? PDF_FONTS.sansEn,
      }}
    >
      {children}
    </Page>
  );
}

interface PdfImageProps {
  src?: string;
  style: PdfStyle;
}

export function PdfImage({ src, style }: PdfImageProps) {
  if (src) {
    // @react-pdf/renderer 的 Image objectFit 通过 style 的 objectFit 控制
    return <Image src={src} style={{ objectFit: 'cover', ...style }} />;
  }
  return <View style={{ backgroundColor: '#e8e4db', ...style }} />;
}

interface PdfFolioProps {
  folio?: string;
  totalPages?: number;
  fallback: string;
}

export function PdfFolio({ folio, totalPages, fallback }: PdfFolioProps) {
  return (
    <View
      style={{
        position: 'absolute',
        bottom: 40,
        right: 50,
        flexDirection: 'row',
      }}
    >
      <Text
        style={{
          fontFamily: PDF_FONTS.serifEn,
          fontStyle: 'italic',
          fontSize: 22,
          color: COLORS.ink,
        }}
      >
        {folio || fallback}
      </Text>
      <Text
        style={{
          fontFamily: PDF_FONTS.serifEn,
          fontStyle: 'italic',
          fontSize: 22,
          color: COLORS.ink3,
        }}
      >
        /{totalPages ?? ''}
      </Text>
    </View>
  );
}
