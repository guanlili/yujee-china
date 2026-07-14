import type { TemplateRenderProps } from '../types';
import { PAGE } from '../constants';
import { WebImage } from '../web-utils';
import { resolveThemeCarrier } from '../theme-carrier';
import { contractRole } from '../contract-role';

// 内页 · 顶部大标题 + 满幅竖图（category: interior，1 图）。白底；顶部一行陶土红超大地名
// 主标题，下方一张满幅竖向大图。文字陶土红 #1c1b18，字体 Inter（sansEn）。
// 版式来自「排版板式」旅行相册库 Figma 稿 A4-24 (node 12:255)（595×842 → ×1.3344 → 794×1123）。

const INK = '#1c1b18';

export function WebMag51({ data, imagePos }: TemplateRenderProps) {
  const d = data as Record<string, string>;
  const title = d['title'] || 'NORWAY';
  const titleTheme = resolveThemeCarrier(data, 'title', contractRole('mag-51', 'title'));
  return (
    <div style={{ position: 'relative', width: PAGE.width, height: PAGE.height, background: '#FFFFFF', overflow: 'hidden' }}>
      {/* 顶部超大地名主标题（槽 title，variableDecor） */}
      <div style={{ position: 'absolute', left: 60, top: 44, width: 734, height: 116, fontFamily: titleTheme.webFontFamily, fontWeight: 700, fontSize: 92, lineHeight: 1, letterSpacing: '2px', color: titleTheme.accentColor ?? INK, whiteSpace: 'nowrap', overflow: 'hidden' }}>{title}</div>

      {/* 满幅竖向大图（槽 image） */}
      <WebImage src={d['image']} style={{ position: 'absolute', left: 60, top: 120, width: 674, height: 917, objectFit: 'cover' }} position={imagePos?.['image']} slotId="image" />
    </div>
  );
}
