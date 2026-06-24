import type { TemplateRenderProps } from '../types';
import { PAGE, WEB_FONTS } from '../constants';
import { WebImage } from '../web-utils';

// 内页（category: interior，1 图 + 1 大标题）。来自 A4-17 (node 12:47)。
// 白底；上方一张居中竖图（槽 image）；底部一行大号展示主标题（槽 title，variableDecor）。
// 文字全为墨色 #1c1b18、Inter（不换花字体）。
// 几何：595×842 → ×1.3344 取整 → 794×1123。最外层固定 794×1123，overflow hidden。
//   图 12:61 (111,26,454×695) → (148,35,606×927)；标题 12:63 (23,726,542×116) → (31,969,723×155)。

const INK = '#1c1b18';

export function WebMag45({ data, imagePos }: TemplateRenderProps) {
  const d = data as Record<string, string>;
  const title = d['title'] || 'Watermelon';
  return (
    <div style={{ position: 'relative', width: PAGE.width, height: PAGE.height, background: '#FFFFFF', overflow: 'hidden' }}>
      {/* ── 居中大图（槽 image，竖图） ── */}
      <WebImage src={d['image']} style={{ position: 'absolute', left: 148, top: 35, width: 606, height: 927, objectFit: 'cover' }} position={imagePos?.['image']} slotId="image" />

      {/* ── 底部大号主标题（槽 title，variableDecor） ── */}
      <div style={{ position: 'absolute', left: 31, top: 969, width: 723, height: 155, fontFamily: WEB_FONTS.sansEn, fontWeight: 700, fontSize: 120, lineHeight: 1, color: INK, whiteSpace: 'nowrap', overflow: 'hidden' }}>{title}</div>
    </div>
  );
}
