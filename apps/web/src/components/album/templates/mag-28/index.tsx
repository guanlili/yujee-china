import type { TemplateRenderProps } from '../types';
import { PAGE } from '../constants';
import { WebImage } from '../web-utils';
import { resolveThemeCarrier } from '../theme-carrier';

// 内页 · 满版大图叠字（category: interior，1 图）。白底；右侧一张满高大图，左侧陶土红大字
// （主标题 + 陈述句）与小图注叠在图上方。全套文字陶土红 #1c1b18，字体 Inter（sansEn）。
// 文字渲染在图之后 → z 顺序在图上层。版式来自「排版板式」旅行相册库 Figma 稿
//（595×842 → ×1.3344 → 794×1123）。

const TERRACOTTA = '#1c1b18';

export function WebMag28({ data, imagePos }: TemplateRenderProps) {
  const d = data as Record<string, string>;
  const titleTheme = resolveThemeCarrier(data, 'title', 'title');
  const headlineTheme = resolveThemeCarrier(data, 'headline', 'title');
  const explainTheme = resolveThemeCarrier(data, 'explain', 'explain');
  return (
    <div style={{ position: 'relative', width: PAGE.width, height: PAGE.height, background: '#FFFFFF', overflow: 'hidden' }}>
      {/* 右侧满高大图（先渲染，文字叠其上） */}
      <WebImage src={d['image']} style={{ position: 'absolute', left: 133, top: 67, width: 661, height: 990, objectFit: 'cover' }} position={imagePos?.['image']} slotId="image" />

      {/* 左侧大字主标题（叠在图上方） */}
      <div style={{ position: 'absolute', left: 28, top: 69, width: 627, fontFamily: titleTheme.webFontFamily, fontWeight: 800, fontSize: 64, lineHeight: 1.05, color: titleTheme.accentColor ?? TERRACOTTA, whiteSpace: 'pre-wrap', overflow: 'hidden' }}>{d['title']}</div>

      {/* 左侧大字陈述句 / 引语（叠在图上方） */}
      <div style={{ position: 'absolute', left: 28, top: 307, width: 627, fontFamily: headlineTheme.webFontFamily, fontWeight: 800, fontSize: 64, lineHeight: 1.05, color: headlineTheme.accentColor ?? TERRACOTTA, whiteSpace: 'pre-wrap', overflow: 'hidden' }}>{d['headline']}</div>

      {/* 左下角小图注 */}
      <div style={{ position: 'absolute', left: 28, bottom: 66, width: 255, fontFamily: explainTheme.webFontFamily, fontWeight: 400, fontSize: 21, lineHeight: 1.35, color: explainTheme.accentColor ?? TERRACOTTA, whiteSpace: 'pre-wrap', overflow: 'hidden' }}>{d['explain']}</div>
    </div>
  );
}
