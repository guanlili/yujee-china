import type { TemplateRenderProps } from '../types';
import { PAGE } from '../constants';
import { WebImage } from '../web-utils';
import { resolveThemeCarrier } from '../theme-carrier';
import { contractRole } from '../contract-role';

// 内页 · 居中竖图 + 上下居中文字（category: interior，1 图）。来自 A4-5 (node 10:115)。
// 白底；中央一张竖图，顶部居中大字主标题压在图上沿，底部居中图注收尾。
// 全套文字硬编码墨色 #1c1b18，字体 Inter（sansEn）。
// 几何：Figma 595×842 → ×1.3344 → 794×1123。
const INK = '#1c1b18';

export function WebMag34({ data, imagePos }: TemplateRenderProps) {
  const d = data as Record<string, string>;
  const titleTheme = resolveThemeCarrier(data, 'title', contractRole('mag-34', 'title'));
  const bodyTheme = resolveThemeCarrier(data, 'body', contractRole('mag-34', 'body'));
  return (
    <div style={{ position: 'relative', width: PAGE.width, height: PAGE.height, background: '#FFFFFF', overflow: 'hidden' }}>
      {/* 中央竖图（先渲染，文字叠其上） */}
      <WebImage src={d['image']} style={{ position: 'absolute', left: 163, top: 234, width: 470, height: 737, objectFit: 'cover' }} position={imagePos?.['image']} slotId="image" />

      {/* 顶部居中大字主标题（压在图上沿） */}
      <div style={{ position: 'absolute', left: 35, top: 187, width: 726, fontFamily: titleTheme.webFontFamily, fontWeight: 800, fontSize: 56, lineHeight: 1.05, color: titleTheme.accentColor ?? INK, textAlign: 'center', whiteSpace: 'pre-wrap', overflow: 'hidden' }}>{d['title']}</div>

      {/* 底部居中图注 */}
      <div style={{ position: 'absolute', left: 44, top: 970, width: 707, fontFamily: bodyTheme.webFontFamily, fontWeight: 400, fontSize: 21, lineHeight: 1.35, color: bodyTheme.accentColor ?? INK, textAlign: 'center', whiteSpace: 'pre-wrap', overflow: 'hidden' }}>{d['body']}</div>
    </div>
  );
}
