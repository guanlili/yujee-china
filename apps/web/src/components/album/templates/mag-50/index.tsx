import type { TemplateRenderProps } from '../types';
import { PAGE, WEB_FONTS } from '../constants';
import { WebImage } from '../web-utils';
import { resolveThemeCarrier } from '../theme-carrier';

// 内页 · 拼贴三图 + 右下角标签骨架（category: interior，3 图）。白底；三张矩形图错落拼贴
// （左满高竖图 + 中横图 + 右上竖图），右下角一组固定骨架标签词 when/where/who/what（硬编码 furniture，
// 不进契约），下方叠一个全大写主标题（title 槽）。全套文字 #1c1b18，字体 Inter（sansEn）。
// 版式来自「排版板式」库 Figma 稿 A4-23 (node 12:229)（595×842 → ×1.3344 → 794×1123）。

const INK = '#1c1b18';

export function WebMag50({ data, imagePos }: TemplateRenderProps) {
  const d = data as Record<string, string>;
  const titleTheme = resolveThemeCarrier(data, 'title');
  const labelStyle = {
    position: 'absolute' as const,
    fontFamily: WEB_FONTS.sansEn,
    fontWeight: 400,
    fontSize: 18,
    lineHeight: 1.0,
    color: INK,
    whiteSpace: 'nowrap' as const,
  };
  return (
    <div style={{ position: 'relative', width: PAGE.width, height: PAGE.height, background: '#FFFFFF', overflow: 'hidden' }}>
      {/* 左侧满高竖图 */}
      <WebImage src={d['image1']} style={{ position: 'absolute', left: 0, top: 382, width: 224, height: 742, objectFit: 'cover' }} position={imagePos?.['image1']} slotId="image1" />

      {/* 中部横图 */}
      <WebImage src={d['image2']} style={{ position: 'absolute', left: 173, top: 510, width: 263, height: 195, objectFit: 'cover' }} position={imagePos?.['image2']} slotId="image2" />

      {/* 右上竖图 */}
      <WebImage src={d['image3']} style={{ position: 'absolute', left: 504, top: 119, width: 263, height: 427, objectFit: 'cover' }} position={imagePos?.['image3']} slotId="image3" />

      {/* 固定骨架标签词（硬编码 furniture，不进契约） */}
      <div style={{ ...labelStyle, left: 436, top: 793 }}>when</div>
      <div style={{ ...labelStyle, left: 595, top: 793 }}>where</div>
      <div style={{ ...labelStyle, left: 436, top: 818 }}>who</div>
      <div style={{ ...labelStyle, left: 595, top: 818 }}>what</div>

      {/* 主标题（title 槽，全大写） */}
      <div style={{ position: 'absolute', left: 436, top: 843, width: 320, fontFamily: WEB_FONTS.sansEn, fontWeight: 400, fontSize: 18, lineHeight: 1.0, color: titleTheme.accentColor ?? INK, textTransform: 'uppercase', whiteSpace: 'pre-wrap', overflow: 'hidden' }}>{d['title']}</div>
    </div>
  );
}
