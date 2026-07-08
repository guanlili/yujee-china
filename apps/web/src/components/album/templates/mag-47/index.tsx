import type { TemplateRenderProps } from '../types';
import { PAGE, WEB_FONTS } from '../constants';
import { WebImage } from '../web-utils';
import { resolveThemeCarrier } from '../theme-carrier';

// 内页 · 错落四图 + 左上叙事文（category: interior，4 图）。来自 A4-19 (node 12:66)。
// 白底；左上一段大字标题 + 小字图注段，四张等大横图（240×176 → 320×235）错落排布：
// image1 右上、image2 左中、image3 右下、image4 左下，按版面位置（上→下、右→左交错）编号。
// 全套文字墨色 #1c1b18、字体 Inter(sansEn)。
// 版式来自 Figma 旅行相册稿 A4-19（595×842 → ×1.3344 → 794×1123）。

const INK = '#1c1b18';

export function WebMag47({ data, imagePos }: TemplateRenderProps) {
  const d = data as Record<string, string>;
  const titleTheme = resolveThemeCarrier(data, 'title');
  const explainTheme = resolveThemeCarrier(data, 'explain');
  return (
    <div style={{ position: 'relative', width: PAGE.width, height: PAGE.height, background: '#FFFFFF', overflow: 'hidden' }}>
      {/* 四张错落横图 */}
      <WebImage src={d['image1']} style={{ position: 'absolute', left: 446, top: 296, width: 320, height: 235, objectFit: 'cover' }} position={imagePos?.['image1']} slotId="image1" />
      <WebImage src={d['image2']} style={{ position: 'absolute', left: 89, top: 468, width: 320, height: 235, objectFit: 'cover' }} position={imagePos?.['image2']} slotId="image2" />
      <WebImage src={d['image3']} style={{ position: 'absolute', left: 446, top: 567, width: 320, height: 235, objectFit: 'cover' }} position={imagePos?.['image3']} slotId="image3" />
      <WebImage src={d['image4']} style={{ position: 'absolute', left: 89, top: 739, width: 320, height: 235, objectFit: 'cover' }} position={imagePos?.['image4']} slotId="image4" />

      {/* 左上大字主标题 */}
      <div style={{ position: 'absolute', left: 89, top: 296, width: 480, fontFamily: WEB_FONTS.sansEn, fontWeight: 600, fontSize: 33, lineHeight: 1.1, color: titleTheme.accentColor ?? INK, whiteSpace: 'pre-wrap', overflow: 'hidden' }}>{d['title']}</div>

      {/* 标题下方小字图注段 */}
      <div style={{ position: 'absolute', left: 89, top: 368, width: 396, fontFamily: WEB_FONTS.sansEn, fontWeight: 400, fontSize: 18, lineHeight: 1.4, color: explainTheme.accentColor ?? INK, whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflow: 'hidden' }}>{d['explain']}</div>
    </div>
  );
}
