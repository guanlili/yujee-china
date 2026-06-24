import type { TemplateRenderProps } from '../types';
import { PAGE, WEB_FONTS } from '../constants';
import { WebImage } from '../web-utils';

// 内页 · 留白收束页（category: interior，1 图）。来自「排版板式」旅行相册库 Figma 稿
// A4-10 (node 11:456)。595×842 → ×1.3344 → 794×1123。白底；下半页一张方形大图，
// 图上方左侧一小段闭合手记（正文），右上角一句倾斜装饰短句（-22°）。
// 全套文字 #1c1b18，字体 Inter（sansEn）。

const INK = '#1c1b18';

export function WebMag37({ data, imagePos }: TemplateRenderProps) {
  const d = data as Record<string, string>;
  return (
    <div style={{ position: 'relative', width: PAGE.width, height: PAGE.height, background: '#FFFFFF', overflow: 'hidden' }}>
      {/* 下半页方形大图 */}
      <WebImage src={d['image']} style={{ position: 'absolute', left: 119, top: 562, width: 532, height: 512, objectFit: 'cover' }} position={imagePos?.['image']} slotId="image" />

      {/* 图上方左侧闭合手记（正文，不加 variableDecor） */}
      <div style={{ position: 'absolute', left: 133, top: 426, width: 252, fontFamily: WEB_FONTS.sansEn, fontWeight: 400, fontSize: 21, lineHeight: 1.35, color: INK, whiteSpace: 'pre-wrap', overflow: 'hidden' }}>{d['body']}</div>

      {/* 右上角倾斜装饰短句（-22°，variableDecor） */}
      <div style={{ position: 'absolute', left: 438, top: 387, width: 280, fontFamily: WEB_FONTS.sansEn, fontWeight: 400, fontSize: 21, lineHeight: 1.35, color: INK, whiteSpace: 'pre-wrap', transform: 'rotate(-22deg)', transformOrigin: 'left top' }}>{d['decor']}</div>
    </div>
  );
}
