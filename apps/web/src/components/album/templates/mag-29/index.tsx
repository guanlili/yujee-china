import type { TemplateRenderProps } from '../types';
import { PAGE } from '../constants';
import { WebImage } from '../web-utils';
import { resolveThemeCarrier } from '../theme-carrier';
import { contractRole } from '../contract-role';

// 内页 · 旅行相册（category: interior，2 图）。白底；上方并排双图，下方右对齐的
// 大标题 / 地名 / 图注。全套文字陶土红 #1c1b18，字体 Inter（sansEn）。
// 版式来自「排版板式」旅行相册库 Figma 稿（595×842 → ×1.3344 → 794×1123）。
// 右对齐元素用 right 锚定 + textAlign:right，与 Figma 右对齐版式一致。

const CLAY = '#1c1b18';

export function WebMag29({ data, imagePos }: TemplateRenderProps) {
  const d = data as Record<string, string>;
  const titleTheme = resolveThemeCarrier(data, 'title', contractRole('mag-29', 'title'));
  const bodyTheme = resolveThemeCarrier(data, 'body', contractRole('mag-29', 'body'));
  const labelTheme = resolveThemeCarrier(data, 'label', contractRole('mag-29', 'label'));
  return (
    <div style={{ position: 'relative', width: PAGE.width, height: PAGE.height, background: '#FFFFFF', overflow: 'hidden' }}>
      {/* 上方并排双图 */}
      <WebImage src={d['image1']} style={{ position: 'absolute', left: 28, top: 67, width: 330, height: 464, objectFit: 'cover' }} position={imagePos?.['image1']} slotId="image1" />
      <WebImage src={d['image2']} style={{ position: 'absolute', left: 362, top: 67, width: 330, height: 464, objectFit: 'cover' }} position={imagePos?.['image2']} slotId="image2" />

      {/* 右对齐大标题 */}
      <div style={{ position: 'absolute', left: 49, top: 694, width: 726, height: 70, fontFamily: titleTheme.webFontFamily, fontWeight: 700, fontSize: 64, lineHeight: 1.1, color: titleTheme.accentColor ?? CLAY, textAlign: 'right', whiteSpace: 'pre-wrap', overflow: 'hidden' }}>{d['title']}</div>

      {/* 右对齐图注 */}
      <div style={{ position: 'absolute', left: 347, top: 762, width: 431, height: 32, fontFamily: bodyTheme.webFontFamily, fontWeight: 400, fontSize: 21, lineHeight: 1.5, color: bodyTheme.accentColor ?? CLAY, textAlign: 'right', whiteSpace: 'pre-wrap', overflow: 'hidden' }}>{d['body']}</div>

      {/* 右对齐地名（装饰标签） */}
      <div style={{ position: 'absolute', left: 49, top: 1007, width: 726, height: 53, fontFamily: labelTheme.webFontFamily, fontWeight: 700, fontSize: 48, lineHeight: 1.1, color: labelTheme.accentColor ?? CLAY, textAlign: 'right', overflow: 'hidden' }}>{d['label']}</div>
    </div>
  );
}
