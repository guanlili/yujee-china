import type { TemplateRenderProps } from '../types';
import { PAGE, WEB_FONTS } from '../constants';
import { WebImage } from '../web-utils';
import { resolveThemeCarrier } from '../theme-carrier';
import { contractRole } from '../contract-role';

// 内页 · 拼贴对角双图叠标签骨架（category: interior，2 图）。来自 A4-18 (node 12:65)。
// 白底；顶部陶土红大字主标题，下面 when/where/who/what 四个固定骨架标签词（硬编码
// furniture，非契约槽）。左侧一张竖图，右下角小竖图与之叠角，右侧小图注承接标题。
// 全套文字陶土红 #1c1b18，字体 Inter（sansEn）。
// 几何来自 Figma 595×842 → ×1.3344 取整 → 794×1123。

const INK = '#1c1b18';

export function WebMag46({ data, imagePos }: TemplateRenderProps) {
  const d = data as Record<string, string>;
  const titleTheme = resolveThemeCarrier(data, 'title', contractRole('mag-46', 'title'));
  const captionTheme = resolveThemeCarrier(data, 'explain', contractRole('mag-46', 'explain'));
  return (
    <div style={{ position: 'relative', width: PAGE.width, height: PAGE.height, background: '#FFFFFF', overflow: 'hidden' }}>
      {/* 顶部大字主标题 */}
      <div style={{ position: 'absolute', left: 91, top: 65, width: 480, fontFamily: titleTheme.webFontFamily, fontWeight: 700, fontSize: 36, lineHeight: 1.1, color: titleTheme.accentColor ?? INK, whiteSpace: 'pre-wrap', overflow: 'hidden' }}>{d['title']}</div>

      {/* 固定骨架标签词 furniture：when / where / who / what（硬编码，不做槽） */}
      <div style={{ position: 'absolute', left: 91, top: 128, fontFamily: WEB_FONTS.sansEn, fontWeight: 600, fontSize: 16, lineHeight: 1.2, color: INK }}>when</div>
      <div style={{ position: 'absolute', left: 231, top: 128, fontFamily: WEB_FONTS.sansEn, fontWeight: 600, fontSize: 16, lineHeight: 1.2, color: INK }}>where</div>
      <div style={{ position: 'absolute', left: 91, top: 153, fontFamily: WEB_FONTS.sansEn, fontWeight: 600, fontSize: 16, lineHeight: 1.2, color: INK }}>who</div>
      <div style={{ position: 'absolute', left: 231, top: 153, fontFamily: WEB_FONTS.sansEn, fontWeight: 600, fontSize: 16, lineHeight: 1.2, color: INK }}>what</div>

      {/* 右侧小图注（承接标题） */}
      <div style={{ position: 'absolute', left: 231, top: 299, width: 334, fontFamily: captionTheme.webFontFamily, fontWeight: 400, fontSize: 16, lineHeight: 1.35, color: captionTheme.accentColor ?? INK, whiteSpace: 'pre-wrap', overflow: 'hidden' }}>{d['explain']}</div>

      {/* 左侧竖图（先渲染） */}
      <WebImage src={d['image1']} style={{ position: 'absolute', left: 91, top: 331, width: 467, height: 730, objectFit: 'cover' }} position={imagePos?.['image1']} slotId="image1" />

      {/* 右下角小竖图（叠在左图右下角之上） */}
      <WebImage src={d['image2']} style={{ position: 'absolute', left: 478, top: 761, width: 226, height: 300, objectFit: 'cover' }} position={imagePos?.['image2']} slotId="image2" />
    </div>
  );
}
