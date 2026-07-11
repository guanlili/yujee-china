import type { ReactNode } from 'react';
import { Font, Image, Page, Text, View } from '@react-pdf/renderer';
import {
  CJK_FONT_MANIFEST,
  type CjkFontId,
} from '@/services/font/font-manifest';
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
  [PDF_FONTS.garamond, 'EBGaramond.ttf'],
  [PDF_FONTS.sourceSerif, 'SourceSerif4.ttf'],
  [PDF_FONTS.lora, 'Lora.ttf'],
  [PDF_FONTS.libreBaskerville, 'LibreBaskerville.ttf'],
  [PDF_FONTS.interEn, 'Inter.ttf'],
  [PDF_FONTS.worksans, 'WorkSans.ttf'],
  [PDF_FONTS.dmSans, 'DMSans.ttf'],
  [PDF_FONTS.poppins, 'Poppins.ttf'],
  [PDF_FONTS.raleway, 'Raleway.ttf'],
  [PDF_FONTS.playfair, 'PlayfairDisplay.ttf'],
  [PDF_FONTS.cormorant, 'CormorantGaramond.ttf'],
  [PDF_FONTS.bebas, 'BebasNeue.ttf'],
  [PDF_FONTS.archivoBlack, 'ArchivoBlack.ttf'],
  [PDF_FONTS.abril, 'AbrilFatface.ttf'],
  [PDF_FONTS.montserrat, 'Montserrat.ttf'],
  [PDF_FONTS.ibmPlexMono, 'IBMPlexMono.ttf'],
  [PDF_FONTS.jetbrainsMono, 'JetBrainsMono.ttf'],
  [PDF_FONTS.greatVibes, 'GreatVibes.ttf'],
  [PDF_FONTS.dancingScript, 'DancingScript.ttf'],
  [PDF_FONTS.sacramento, 'Sacramento.ttf'],
  [PDF_FONTS.parisienne, 'Parisienne.ttf'],
];
function registerLatin(family: string, file: string): void {
  const src = `/fonts/${file}`;
  Font.register({
    family,
    fonts: [{ src }, { src, fontWeight: 'bold' }, { src, fontStyle: 'italic' }, { src, fontWeight: 'bold', fontStyle: 'italic' }],
  });
}

function removeRegisteredFamily(family: string): void {
  delete Font.getRegisteredFonts()[family];
}

// @react-pdf's FontStore appends duplicate family sources and resolves the first
// exact match. Remove our owned families before each export so album B cannot
// accidentally reuse album A's character subset. Built-ins such as Courier stay.
export interface PdfFontSubset {
  sans: string;
  serif: string;
  artFonts?: Partial<Record<CjkFontId, { family: string; base64: string }>>;
}

export function registerPdfFonts(subset: PdfFontSubset): void {
  for (const font of Object.values(CJK_FONT_MANIFEST)) removeRegisteredFamily(font.pdfFamily);
  for (const [family] of LATIN_PDF_FONTS) removeRegisteredFamily(family);

  registerCjk('NotoSerifSC', `data:font/ttf;base64,${subset.serif}`);
  registerCjk('NotoSansSC', `data:font/ttf;base64,${subset.sans}`);
  for (const font of Object.values(subset.artFonts ?? {})) {
    if (font) registerCjk(font.family, `data:font/ttf;base64,${font.base64}`);
  }
  for (const [fam, file] of LATIN_PDF_FONTS) registerLatin(fam, file);
}

// The renderer owns one global FontStore. Keep registration + layout inside one
// critical section so simultaneous exports cannot replace each other's subsets.
let pdfFontQueue: Promise<void> = Promise.resolve();

export async function withRegisteredPdfFonts<T>(
  subset: PdfFontSubset,
  render: () => Promise<T>,
): Promise<T> {
  let release!: () => void;
  const previous = pdfFontQueue;
  pdfFontQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    registerPdfFonts(subset);
    return await render();
  } finally {
    release();
  }
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
      // 相册页全部是固定 A4 绝对定位版面,永远单页:关掉 @react-pdf 的自动分页。
      // 开着时,底边超出页高的绝对定位 Text(如 mag-45/53 的大标题换行后)会让
      // 分页器陷入死循环 —— 导出按钮点了主线程直接卡死(实测)。溢出内容按
      // web 同义裁切在页内。
      wrap={false}
      style={{
        position: 'relative',
        backgroundColor: dark ? COLORS.ink : '#FFFFFF',
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
  // #165 per-slot override. Absent => centered cover (pre-#165 default).
  position?: { x: number; y: number; scale: number };
}

export function PdfImage({ src, style, position }: PdfImageProps) {
  if (src) {
    // @react-pdf/renderer 的 Image objectFit 通过 style 的 objectFit 控制；
    // objectPosition 同样接受 "x% y%"，故 dx/dy 在 PDF 与 web 一致生效。
    const objectPosition = position ? `${position.x}% ${position.y}%` : '50% 50%';
    const scale = position && position.scale > 1 ? position.scale : 1;
    // #168: mirror the web render (web-utils.tsx WebImage). The caller `style` is
    // the SLOT geometry — it becomes an `overflow:hidden` wrapper <View> so a
    // zoomed image is CLIPPED to the fixed frame, never grows the slot. objectFit/
    // objectPosition are paint props that belong on the inner <Image>, so strip
    // them off the wrapper (some templates inline objectFit:'cover' in `style`).
    const { objectFit: _of, objectPosition: _op, ...frame } = style;
    if (scale === 1) {
      // No zoom: inner Image fills the frame 100%×100% with cover+objectPosition.
      // This is pixel-identical to the pre-#168 single-<Image> render (an Image
      // filling a same-size box covers the same pixels), so existing albums don't
      // regress; the wrapper's clip only ever bites once scale>1.
      return (
        <View style={{ ...frame, overflow: 'hidden' }}>
          <Image
            src={src}
            style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition }}
          />
        </View>
      );
    }
    // @react-pdf has no CSS `transform`, so emulate web's `transform: scale(s)` with
    // transform-origin `x% y%`. Web composes cover(+objectPosition) THEN scale; we
    // reproduce that composition exactly: an inner zoom <View> sized s×100% holds the
    // Image at 100%×100% (so cover+objectPosition resolve identically to web inside a
    // box that is itself s× larger), and the zoom View is offset so the focal point
    // (x%,y%) stays anchored. Holding (x%,y%) fixed means shifting the s× box left/up
    // by (s-1)·x% / (s-1)·y% of the FRAME — expressible as percentages of the wrapper,
    // so this is correct for every template regardless of how its width/height resolve
    // (numeric, left+right, top+bottom). The wrapper's overflow:hidden clips the rest.
    const offX = -((scale - 1) * position!.x);
    const offY = -((scale - 1) * position!.y);
    return (
      <View style={{ ...frame, overflow: 'hidden' }}>
        <View
          style={{
            position: 'absolute',
            left: `${offX}%`,
            top: `${offY}%`,
            width: `${scale * 100}%`,
            height: `${scale * 100}%`,
          }}
        >
          <Image
            src={src}
            style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition }}
          />
        </View>
      </View>
    );
  }
  return <View style={{ backgroundColor: '#e8e4db', ...style }} />;
}

interface PdfFolioProps {
  folio?: string;
  totalPages?: number;
  fallback: string;
  accentColor?: string;
  fontFamily?: string;
}

export function PdfFolio({ folio, totalPages, fallback, accentColor, fontFamily }: PdfFolioProps) {
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
          fontFamily: fontFamily ?? PDF_FONTS.serifEn,
          fontStyle: 'italic',
          fontSize: 22,
          color: accentColor ?? COLORS.ink,
        }}
      >
        {folio || fallback}
      </Text>
      <Text
        style={{
          fontFamily: fontFamily ?? PDF_FONTS.serifEn,
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
