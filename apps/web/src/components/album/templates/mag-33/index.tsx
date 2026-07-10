import type { TemplateRenderProps } from '../types';
import { PAGE } from '../constants';
import { WebImage } from '../web-utils';
import { resolveThemeCarrier } from '../theme-carrier';

// 内页 · 三联横图（category: interior，3 图）。白底；三张等大横图（376×247）
// 垂直堆叠、水平居中偏左，左侧留白放竖排大字标题，每张图右侧留白放小图注。
// 全套文字 #1c1b18，字体 Inter（sansEn）。
// 来自 Figma A4-2 (node 5:21)，595×842 → ×1.3344 → 794×1123。

const INK = '#1c1b18';

export function WebMag33({ data, imagePos }: TemplateRenderProps) {
  const d = data as Record<string, string>;
  const titleTheme = resolveThemeCarrier(data, 'title', 'title');
  const caption1Theme = resolveThemeCarrier(data, 'caption1', 'explain');
  const caption2Theme = resolveThemeCarrier(data, 'caption2', 'explain');
  const caption3Theme = resolveThemeCarrier(data, 'caption3', 'explain');
  return (
    <div style={{ position: 'relative', width: PAGE.width, height: PAGE.height, background: '#FFFFFF', overflow: 'hidden' }}>
      {/* 三张等大横图（垂直堆叠） */}
      <WebImage src={d['image1']} style={{ position: 'absolute', left: 200, top: 159, width: 376, height: 247, objectFit: 'cover' }} position={imagePos?.['image1']} slotId="image1" />
      <WebImage src={d['image2']} style={{ position: 'absolute', left: 200, top: 438, width: 376, height: 247, objectFit: 'cover' }} position={imagePos?.['image2']} slotId="image2" />
      <WebImage src={d['image3']} style={{ position: 'absolute', left: 200, top: 717, width: 376, height: 247, objectFit: 'cover' }} position={imagePos?.['image3']} slotId="image3" />

      {/* 左侧竖排大字标题（在三联图左侧留白） */}
      <div style={{ position: 'absolute', left: 28, top: 159, width: 150, fontFamily: titleTheme.webFontFamily, fontWeight: 800, fontSize: 44, lineHeight: 1.05, color: titleTheme.accentColor ?? INK, whiteSpace: 'pre-wrap', overflow: 'hidden' }}>{d['title']}</div>

      {/* 每张图右侧小图注（在右侧留白） */}
      <div style={{ position: 'absolute', left: 596, top: 159, width: 178, fontFamily: caption1Theme.webFontFamily, fontWeight: 400, fontSize: 16, lineHeight: 1.35, color: caption1Theme.accentColor ?? INK, whiteSpace: 'pre-wrap', overflow: 'hidden' }}>{d['caption1']}</div>
      <div style={{ position: 'absolute', left: 596, top: 438, width: 178, fontFamily: caption2Theme.webFontFamily, fontWeight: 400, fontSize: 16, lineHeight: 1.35, color: caption2Theme.accentColor ?? INK, whiteSpace: 'pre-wrap', overflow: 'hidden' }}>{d['caption2']}</div>
      <div style={{ position: 'absolute', left: 596, top: 717, width: 178, fontFamily: caption3Theme.webFontFamily, fontWeight: 400, fontSize: 16, lineHeight: 1.35, color: caption3Theme.accentColor ?? INK, whiteSpace: 'pre-wrap', overflow: 'hidden' }}>{d['caption3']}</div>
    </div>
  );
}
