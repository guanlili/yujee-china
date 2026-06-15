import type { ReactNode } from 'react';
import { Font, Image, Page, Text, View } from '@react-pdf/renderer';
import { COLORS, PAGE, PDF_FONTS } from './constants';

// Per-album subset TTFs come from POST /api/v1/fonts/subset (~17MB full fonts
// → typically <100KB), so registration happens at export time with the freshly
// cut bytes — not at module load (the full fonts no longer live in public/).
// CJK has no real italic/bold cut, so map every style/weight a template might
// ask for (17× italic, 1× medium across templates) to the one Regular cut —
// keeps glyphs correct and stops @react-pdf throwing on an unregistered variant.
function registerCjk(family: string, src: string): void {
  Font.register({
    family,
    fonts: [
      { src },
      { src, fontStyle: 'italic' },
      { src, fontWeight: 'medium' },
      { src, fontWeight: 'bold' },
      { src, fontWeight: 'bold', fontStyle: 'italic' },
    ],
  });
}

// 拉丁装饰字体（仅英文）：从 /fonts/*.ttf 注册，和 web @font-face 同一份文件 → 导出与预览一致。
// 这些字无中文字形，只用于英文槽（canvas codegen 已按 lang 区分，中文槽走 Noto）。
const LATIN_PDF_FONTS: [string, string][] = [
  ['EB Garamond', 'EBGaramond.ttf'], ['Inter', 'Inter.ttf'], ['Playfair Display', 'PlayfairDisplay.ttf'],
  ['Lora', 'Lora.ttf'], ['Abril Fatface', 'AbrilFatface.ttf'], ['Montserrat', 'Montserrat.ttf'],
  ['Poppins', 'Poppins.ttf'], ['Work Sans', 'WorkSans.ttf'], ['Raleway', 'Raleway.ttf'], ['Bebas Neue', 'BebasNeue.ttf'],
];
function registerLatin(family: string, file: string): void {
  const src = `/fonts/${file}`;
  Font.register({
    family,
    fonts: [{ src }, { src, fontWeight: 'bold' }, { src, fontStyle: 'italic' }, { src, fontWeight: 'bold', fontStyle: 'italic' }],
  });
}

// Called by lib/pdf/render.ts right before pdf().toBlob(). Re-registering a
// family replaces its sources, so each export uses that album's own subset.
export function registerPdfFonts(subset: { sans: string; serif: string }): void {
  registerCjk('NotoSerifSC', `data:font/ttf;base64,${subset.serif}`);
  registerCjk('NotoSansSC', `data:font/ttf;base64,${subset.sans}`);
  for (const [fam, file] of LATIN_PDF_FONTS) registerLatin(fam, file);
}

// CJK lines have no spaces; @react-pdf won't wrap them on its own. Treat each
// CJK char as its own break opportunity while keeping Latin runs intact, so
// long Chinese paragraphs wrap instead of overflowing the page.
Font.registerHyphenationCallback((word) => {
  const parts = word.match(/[　-鿿＀-￯]|[^　-鿿＀-￯]+/g);
  return parts && parts.length > 1 ? parts : [word];
});

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
    return (
      <Image
        src={src}
        style={{
          ...style,
          objectFit: 'cover',
          objectPosition: '50% 50%',
        }}
      />
    );
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
