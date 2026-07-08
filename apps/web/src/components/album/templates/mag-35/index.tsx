import type { TemplateRenderProps } from '../types';
import { PAGE, WEB_FONTS } from '../constants';
import { WebImage } from '../web-utils';
import { resolveThemeCarrier } from '../theme-carrier';

// 内页 · 满版绿底收束页（category: interior，1 图）。整页铺绿色底色 #81a46d；
// 左上 / 右上一对小标签（label / date），中部偏左一张竖图，图下散文式收束语。
// 全套文字墨色 #1c1b18，字体 Inter（sansEn）。文字渲染在图之后 → z 顺序在图上层。
// 版式来自「排版板式」A4-6（node 11:263）：595×842 → ×1.3344 → 794×1123。

const INK = '#1c1b18';

export function WebMag35({ data, imagePos }: TemplateRenderProps) {
  const d = data as Record<string, string>;
  const labelTheme = resolveThemeCarrier(data, 'label');
  const dateTheme = resolveThemeCarrier(data, 'date');
  const bodyTheme = resolveThemeCarrier(data, 'body');
  return (
    <div style={{ position: 'relative', width: PAGE.width, height: PAGE.height, background: '#FFFFFF', overflow: 'hidden' }}>
      {/* 整页绿色底色块（Figma Rectangle 7 满版填充 #81a46d） */}
      <div style={{ position: 'absolute', left: 0, top: 0, width: PAGE.width, height: PAGE.height, background: '#81a46d' }} />

      {/* 竖图（先渲染，文字叠其上） */}
      <WebImage src={d['image']} style={{ position: 'absolute', left: 148, top: 160, width: 318, height: 408, objectFit: 'cover' }} position={imagePos?.['image']} slotId="image" />

      {/* 左上小标签 */}
      <div style={{ position: 'absolute', left: 156, top: 160, width: 135, fontFamily: WEB_FONTS.sansEn, fontWeight: 400, fontSize: 21, lineHeight: 1.3, color: labelTheme.accentColor ?? INK, whiteSpace: 'pre-wrap', overflow: 'hidden' }}>{d['label']}</div>

      {/* 右上日期小标签（右对齐） */}
      <div style={{ position: 'absolute', left: 330, top: 160, width: 135, textAlign: 'right', fontFamily: WEB_FONTS.sansEn, fontWeight: 400, fontSize: 21, lineHeight: 1.3, color: dateTheme.accentColor ?? INK, whiteSpace: 'pre-wrap', overflow: 'hidden' }}>{d['date']}</div>

      {/* 图下散文式收束语 */}
      <div style={{ position: 'absolute', left: 156, top: 220, width: 242, fontFamily: WEB_FONTS.sansEn, fontWeight: 400, fontSize: 21, lineHeight: 1.35, color: bodyTheme.accentColor ?? INK, whiteSpace: 'pre-wrap', overflow: 'hidden' }}>{d['body']}</div>
    </div>
  );
}
