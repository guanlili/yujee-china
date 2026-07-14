import type { TemplateRenderProps } from '../types';
import { PAGE, WEB_FONTS } from '../constants';
import { WebImage } from '../web-utils';
import { resolveThemeCarrier } from '../theme-carrier';
import { contractRole } from '../contract-role';

// 内页 · 顶部超大标题 + 单张近方大图（category: interior，1 图）。白底；页顶横排超大展示主标题
// （槽 title，占位「NORWAY」，首字母 N 略大、其余略小，但内容为同一个槽）；标题字内负空间里
// 嵌固定骨架标签 when / where / who / what（2×2，写死 furniture，不进契约、不可填）；
// 中下部一张近方大图铺开。全套文字陶土红 #1c1b18，字体 Inter（sansEn）。
// 版式来自「排版板式」旅行相册库 Figma 稿 A4-22（node 12:228，595×842 → ×1.3344 → 794×1123）。

const INK = '#1c1b18';

export function WebMag49({ data, imagePos }: TemplateRenderProps) {
  const d = data as Record<string, string>;
  const title = d['title'] || 'NORWAY';
  const head = title.charAt(0);
  const rest = title.slice(1);
  const titleTheme = resolveThemeCarrier(data, 'title', contractRole('mag-49', 'title'));
  return (
    <div style={{ position: 'relative', width: PAGE.width, height: PAGE.height, background: '#FFFFFF', overflow: 'hidden' }}>
      {/* ── 顶部超大主标题（槽 title，占位 NORWAY，首字母略大，variableDecor） ── */}
      <div style={{ position: 'absolute', left: 28, top: 150, width: 738, height: 155, fontFamily: titleTheme.webFontFamily, fontWeight: 700, lineHeight: 1, color: titleTheme.accentColor ?? INK, whiteSpace: 'nowrap', overflow: 'hidden', display: 'flex', alignItems: 'baseline' }}>
        <span style={{ fontSize: 155 }}>{head}</span>
        <span style={{ fontSize: 124 }}>{rest}</span>
      </div>

      {/* ── 固定骨架标签 when / where / who / what（furniture，2×2，非槽位） ── */}
      <div style={{ position: 'absolute', left: 119, top: 44, width: 93, fontFamily: WEB_FONTS.sansEn, fontWeight: 400, fontSize: 21, lineHeight: 1.2, color: INK }}>when</div>
      <div style={{ position: 'absolute', left: 239, top: 44, width: 93, fontFamily: WEB_FONTS.sansEn, fontWeight: 400, fontSize: 21, lineHeight: 1.2, color: INK }}>where</div>
      <div style={{ position: 'absolute', left: 119, top: 70, width: 93, fontFamily: WEB_FONTS.sansEn, fontWeight: 400, fontSize: 21, lineHeight: 1.2, color: INK }}>who</div>
      <div style={{ position: 'absolute', left: 239, top: 70, width: 93, fontFamily: WEB_FONTS.sansEn, fontWeight: 400, fontSize: 21, lineHeight: 1.2, color: INK }}>what</div>

      {/* ── 中下部近方大图（槽 image） ── */}
      <WebImage src={d['image']} style={{ position: 'absolute', left: 28, top: 306, width: 674, height: 699, objectFit: 'cover' }} position={imagePos?.['image']} slotId="image" />
    </div>
  );
}
