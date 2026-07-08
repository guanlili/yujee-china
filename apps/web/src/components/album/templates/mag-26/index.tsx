import type { TemplateRenderProps } from '../types';
import { COLORS, PAGE, WEB_FONTS } from '../constants';
import { WebImage } from '../web-utils';
import { resolveThemeCarrier } from '../theme-carrier';

// 内页 · 竖排标题图文页（category: interior，1 图）。白底；右侧一张几乎满高的竖长图，
// 左侧竖排大标题（rotate -90°）+ 两条竖排英文装饰小字 + 横排导语小标题 + 正文段落。
// 引号装饰与导语上方细线是固定 furniture、不进契约。
// 版式来自 Figma 内页稿（595×842 → ×1.3344 → 794×1123）。

export function WebMag26({ data, imagePos }: TemplateRenderProps) {
  const d = data as Record<string, string>;
  const titleTheme = resolveThemeCarrier(data, 'title');
  const label1Theme = resolveThemeCarrier(data, 'label1');
  const label2Theme = resolveThemeCarrier(data, 'label2');
  const explainTheme = resolveThemeCarrier(data, 'explain');
  const bodyTheme = resolveThemeCarrier(data, 'body');
  return (
    <div style={{ position: 'relative', width: PAGE.width, height: PAGE.height, background: '#FFFFFF', overflow: 'hidden' }}>
      {/* 右侧竖长图（几乎满高） */}
      <WebImage src={d['image']} style={{ position: 'absolute', left: 330, top: 52, width: 426, height: 1015, objectFit: 'cover' }} position={imagePos?.['image']} slotId="image" />

      {/* 竖排大标题（rotate -90°，沿左侧自下而上）—— 原字 Inter ExtraBold → sansEn 800 */}
      <div style={{ position: 'absolute', left: 130, top: 404, width: 333, height: 150, transform: 'rotate(-90deg)', transformOrigin: 'top left', fontFamily: WEB_FONTS.sansEn, fontWeight: 800, fontSize: 75, lineHeight: 1, color: titleTheme.accentColor ?? COLORS.ink, whiteSpace: 'pre-wrap', overflow: 'hidden' }}>{d['title']}</div>

      {/* 竖排英文装饰小字 · 靠内侧（rotate -90°）—— 原字 Song Myung → serifCn 顶替 */}
      <div style={{ position: 'absolute', left: 43, top: 460, width: 200, height: 24, transform: 'rotate(-90deg)', transformOrigin: 'top left', fontFamily: WEB_FONTS.serifCn, fontSize: 24, lineHeight: 1, color: label1Theme.accentColor ?? COLORS.ink, whiteSpace: 'nowrap', overflow: 'hidden' }}>{d['label1']}</div>

      {/* 竖排英文装饰小字 · 靠外侧（rotate -90°）—— 原字 Song Myung → serifCn 顶替 */}
      <div style={{ position: 'absolute', left: 76, top: 440, width: 240, height: 24, transform: 'rotate(-90deg)', transformOrigin: 'top left', fontFamily: WEB_FONTS.serifCn, fontSize: 24, lineHeight: 1, color: label2Theme.accentColor ?? COLORS.ink, whiteSpace: 'nowrap', overflow: 'hidden' }}>{d['label2']}</div>

      {/* 固定 furniture · 引号装饰字形（非槽位） */}
      <div style={{ position: 'absolute', left: 183, top: 452, width: 113, height: 85, fontFamily: WEB_FONTS.serifEn, fontSize: 120, lineHeight: 1, color: COLORS.ink, userSelect: 'none', overflow: 'hidden' }}>&rdquo;</div>

      {/* 固定 furniture · 导语上方细分隔线（非槽位） */}
      <div style={{ position: 'absolute', left: 53, top: 710, width: 227, height: 1, background: COLORS.ink }} />

      {/* 导语小标题（横排）—— 原字 Song Myung → serifCn 顶替 */}
      <div style={{ position: 'absolute', left: 53, top: 587, width: 243, height: 25, fontFamily: WEB_FONTS.serifCn, fontSize: 24, lineHeight: 1.3, color: explainTheme.accentColor ?? COLORS.ink, whiteSpace: 'pre-wrap', overflow: 'hidden' }}>{d['explain']}</div>

      {/* 正文段落 —— 原字 PingFang SC → sansCn */}
      <div style={{ position: 'absolute', left: 56, top: 754, width: 240, height: 267, fontFamily: WEB_FONTS.sansCn, fontSize: 19, lineHeight: 1.6, color: bodyTheme.accentColor ?? COLORS.ink, whiteSpace: 'pre-wrap', overflow: 'hidden' }}>{d['body']}</div>
    </div>
  );
}
