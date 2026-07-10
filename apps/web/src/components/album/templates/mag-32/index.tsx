import type { TemplateRenderProps } from '../types';
import { PAGE } from '../constants';
import { WebImage } from '../web-utils';
import { resolveThemeCarrier } from '../theme-carrier';

// 封面（category: cover，1 图）。白底；满高大图（偏右）铺满整页；
// 左下角大号主标题；左缘竖排大地名 NORWAY（旋转 90°）。文字全为陶土红 #1c1b18、Inter。
// 版式来自「排版板式」旅行相册库 Figma 稿（595×842 → ×1.3344 → 794×1123）。
// 取舍：主竖排大 NORWAY 建成 label 槽（可填）；Figma 原稿另两处小 NORWAY（左下竖排小、底部横排小）
// 是同一地名的纯装饰重复，建成固定 furniture（写死 'NORWAY'、不进契约、不可填），避免多建冗余地名槽。

const CLAY = '#1c1b18';

export function WebMag32({ data, imagePos }: TemplateRenderProps) {
  const d = data as Record<string, string>;
  const label = d['label'] || 'NORWAY';
  const title = d['title'] || 'North\nLight';
  const labelTheme = resolveThemeCarrier(data, 'label', 'decoration');
  const titleTheme = resolveThemeCarrier(data, 'title', 'title');
  return (
    <div style={{ position: 'relative', width: PAGE.width, height: PAGE.height, background: '#FFFFFF', overflow: 'hidden' }}>
      {/* ── 封面满高大图（槽 image，偏右铺满整页高度） ── */}
      <WebImage src={d['image']} style={{ position: 'absolute', left: 103, top: 0, width: 691, height: 1123, objectFit: 'cover' }} position={imagePos?.['image']} slotId="image" />

      {/* ── 主竖排大地名 NORWAY（槽 label，左缘旋转 90°，variableDecor） ── */}
      <div style={{ position: 'absolute', left: 95, top: 160, width: 800, fontFamily: labelTheme.webFontFamily, fontWeight: 700, fontSize: 85, lineHeight: 1, letterSpacing: '8.5px', color: labelTheme.accentColor ?? CLAY, whiteSpace: 'nowrap', transform: 'rotate(90deg)', transformOrigin: 'left top' }}>{label}</div>

      {/* ── 主标题（槽 title，左下角大展示字） ── */}
      <div style={{ position: 'absolute', left: 56, top: 710, width: 300, height: 360, fontFamily: titleTheme.webFontFamily, fontWeight: 700, fontSize: 96, lineHeight: 1.05, color: titleTheme.accentColor ?? CLAY, whiteSpace: 'pre-wrap', overflow: 'hidden' }}>{title}</div>

      {/* ── 固定装饰：左下竖排小 NORWAY（furniture，非槽位，旋转 90°） ── */}
      <div style={{ position: 'absolute', left: 50, top: 760, width: 300, fontFamily: labelTheme.webFontFamily, fontWeight: 400, fontSize: 43, lineHeight: 1, letterSpacing: '4px', color: CLAY, whiteSpace: 'nowrap', transform: 'rotate(90deg)', transformOrigin: 'left top' }}>{label}</div>

      {/* ── 固定装饰：底部横排小 NORWAY（furniture，非槽位） ── */}
      <div style={{ position: 'absolute', left: 56, top: 1066, width: 300, fontFamily: labelTheme.webFontFamily, fontWeight: 400, fontSize: 43, lineHeight: 1, letterSpacing: '4px', color: CLAY, whiteSpace: 'nowrap' }}>{label}</div>
    </div>
  );
}
