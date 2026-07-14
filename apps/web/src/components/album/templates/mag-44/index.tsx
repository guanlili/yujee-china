import type { TemplateRenderProps } from '../types';
import { PAGE } from '../constants';
import { WebImage } from '../web-utils';
import { resolveThemeCarrier } from '../theme-carrier';
import { contractRole } from '../contract-role';

// 来自 A4-16 (node 12:46)。内页 · 大字拼贴（category: interior，2 图）。白底；
// 左上超大字主标题（Notes 风），右上一张竖图、左下一张竖图错落拼贴，中部一行短句、
// 右下角一段图注收尾。全套文字 #1c1b18，字体 Inter（sansEn）。
// 595×842 → ×1.3344 → 794×1123，最外层固定尺寸 + overflow hidden。

const INK = '#1c1b18';

export function WebMag44({ data, imagePos }: TemplateRenderProps) {
  const d = data as Record<string, string>;
  const titleTheme = resolveThemeCarrier(data, 'title', contractRole('mag-44', 'title'));
  const lineTheme = resolveThemeCarrier(data, 'explain', contractRole('mag-44', 'explain'));
  const captionTheme = resolveThemeCarrier(data, 'body', contractRole('mag-44', 'body'));
  return (
    <div style={{ position: 'relative', width: PAGE.width, height: PAGE.height, background: '#FFFFFF', overflow: 'hidden' }}>
      {/* 右上竖图（12:51） */}
      <WebImage src={d['image1']} style={{ position: 'absolute', left: 438, top: 28, width: 356, height: 527, objectFit: 'cover' }} position={imagePos?.['image1']} slotId="image1" />

      {/* 左下竖图（12:53） */}
      <WebImage src={d['image2']} style={{ position: 'absolute', left: 28, top: 555, width: 364, height: 536, objectFit: 'cover' }} position={imagePos?.['image2']} slotId="image2" />

      {/* 左上超大字主标题（12:55 "Notes"） */}
      <div style={{ position: 'absolute', left: 28, top: 28, width: 480, fontFamily: titleTheme.webFontFamily, fontWeight: 700, fontSize: 108, lineHeight: 1.0, color: titleTheme.accentColor ?? INK, whiteSpace: 'pre-wrap', overflow: 'hidden' }}>{d['title']}</div>

      {/* 中部一行短句（12:57） */}
      <div style={{ position: 'absolute', left: 28, top: 508, width: 334, fontFamily: lineTheme.webFontFamily, fontWeight: 400, fontSize: 21, lineHeight: 1.35, color: lineTheme.accentColor ?? INK, whiteSpace: 'pre-wrap', overflow: 'hidden' }}>{d['explain']}</div>

      {/* 右下角图注段（12:59） */}
      <div style={{ position: 'absolute', left: 405, top: 965, width: 356, fontFamily: captionTheme.webFontFamily, fontWeight: 400, fontSize: 21, lineHeight: 1.35, color: captionTheme.accentColor ?? INK, whiteSpace: 'pre-wrap', overflow: 'hidden' }}>{d['body']}</div>
    </div>
  );
}
