import { Image, Path, Svg, Text, View } from '@react-pdf/renderer';
import { PAGE, PDF_FONTS } from '../constants';
import { PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';
import { YUJEE_LOGO_PNG } from '../brand-logo';

// 杂志封底（PDF 端，与 index.tsx 同一版面）。纯白底（铺满整页的白 View 覆盖 Shell 暖纸色）；
// 中部图片（image1）；左下角品牌 logo + 版权，右下角 Instagram / X / TikTok 图标 + 网址，均为固定品牌落款。

const IG_PATH =
  'M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z';
const X_PATH =
  'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z';
const TIKTOK_PATH =
  'M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z';

export function PdfMag20({ data }: TemplateRenderProps) {
  const d = data as Record<string, string>;
  const year = new Date().getFullYear();
  return (
    <PdfPageShell>
      {/* 纯白底（覆盖 Shell 暖纸色） */}
      <View style={{ position: 'absolute', left: 0, top: 0, width: PAGE.width, height: PAGE.height, backgroundColor: '#FFFFFF' }} />

      {/* 封底图片（唯一可编辑槽位） */}
      <PdfImage src={d['image1']} style={{ position: 'absolute', left: 256, top: 240, width: 282, height: 364 }} />

      {/* 左下角：品牌 logo */}
      <Image src={YUJEE_LOGO_PNG} style={{ position: 'absolute', left: 56, top: 979, width: 112, height: 47, objectFit: 'contain' }} />

      {/* 左下角：版权 */}
      <Text style={{ position: 'absolute', left: 56, top: 1038, width: 110, fontFamily: PDF_FONTS.interEn, fontSize: 16, color: '#C2C2C2' }}>© {year} Yujee</Text>

      {/* 右下角：Instagram 图标 */}
      <Svg viewBox="0 0 24 24" style={{ position: 'absolute', left: 600, top: 988, width: 28, height: 28 }}>
        <Path d={IG_PATH} fill="#999999" />
      </Svg>

      {/* 右下角：X 图标 */}
      <Svg viewBox="0 0 24 24" style={{ position: 'absolute', left: 655, top: 988, width: 28, height: 28 }}>
        <Path d={X_PATH} fill="#999999" />
      </Svg>

      {/* 右下角：TikTok 图标 */}
      <Svg viewBox="0 0 24 24" style={{ position: 'absolute', left: 710, top: 988, width: 28, height: 28 }}>
        <Path d={TIKTOK_PATH} fill="#999999" />
      </Svg>

      {/* 右下角：网址 */}
      <Text style={{ position: 'absolute', left: 600, top: 1034, width: 138, fontFamily: PDF_FONTS.interEn, fontSize: 16, letterSpacing: 0.28, color: '#999999' }}>www.yujeeai.com</Text>
    </PdfPageShell>
  );
}
