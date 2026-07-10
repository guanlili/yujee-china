import type { TemplateRenderProps } from '../types';
import { PAGE } from '../constants';
import { WebImage } from '../web-utils';
import { resolveThemeCarrier } from '../theme-carrier';

// 内页 · 上下满版双图叠字（category: interior，2 图）。来自 A4-13 (node 11:485)。
// 上下两块满宽图槽（上 595×383 / 下 595×459 → ×1.3344），中间居中一段陶土色大字
// 陈述句跨在两图交界处。全套文字 #1c1b18，字体 Inter（sansEn）。文字在图之后渲染 → z 在图上层。
//（595×842 → ×1.3344 → 794×1123）。

const INK = '#1c1b18';

export function WebMag38({ data, imagePos }: TemplateRenderProps) {
  const d = data as Record<string, string>;
  const bodyTheme = resolveThemeCarrier(data, 'body', 'title');
  return (
    <div style={{ position: 'relative', width: PAGE.width, height: PAGE.height, background: '#FFFFFF', overflow: 'hidden' }}>
      {/* 上方满宽图（先渲染，文字叠其上） */}
      <WebImage src={d['image1']} style={{ position: 'absolute', left: 0, top: 0, width: 794, height: 511, objectFit: 'cover' }} position={imagePos?.['image1']} slotId="image1" />

      {/* 下方满宽图 */}
      <WebImage src={d['image2']} style={{ position: 'absolute', left: 0, top: 511, width: 794, height: 612, objectFit: 'cover' }} position={imagePos?.['image2']} slotId="image2" />

      {/* 居中大字陈述句（跨在两图交界处） */}
      <div style={{ position: 'absolute', left: 87, top: 284, width: 620, textAlign: 'center', fontFamily: bodyTheme.webFontFamily, fontWeight: 700, fontSize: 48, lineHeight: 1.15, color: bodyTheme.accentColor ?? INK, whiteSpace: 'pre-wrap', overflow: 'hidden' }}>{d['body']}</div>
    </div>
  );
}
