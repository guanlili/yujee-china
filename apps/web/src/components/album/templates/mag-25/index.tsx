import type { TemplateRenderProps } from '../types';
import { COLORS, PAGE, WEB_FONTS } from '../constants';
import { WebImage } from '../web-utils';
import { YUJEE_LOGO_SVG } from '../brand-logo';

// 封底（category: ending，2 图）。白底；左半两张竖图上下叠放，右半文字：
// 大号装饰数字 + 竖排作者署名 + 日期 + 两行主标题 + 结尾文案；右下角固定品牌落款（logo + 版权）。
// 版式来自 Figma 封底稿（595×842 → ×1.3344 → 794×1123）。品牌落款是固定 furniture、不进契约（同 mag-20）。

export function WebMag25({ data, imagePos }: TemplateRenderProps) {
  const d = data as Record<string, string>;
  const year = new Date().getFullYear();
  return (
    <div style={{ position: 'relative', width: PAGE.width, height: PAGE.height, background: '#FFFFFF', overflow: 'hidden' }}>
      {/* 左上大图 */}
      <WebImage src={d['image1']} style={{ position: 'absolute', left: 0, top: 56, width: 426, height: 636, objectFit: 'cover' }} position={imagePos?.['image1']} slotId="image1" />

      {/* 左下图 */}
      <WebImage src={d['image2']} style={{ position: 'absolute', left: 0, top: 692, width: 426, height: 375, objectFit: 'cover' }} position={imagePos?.['image2']} slotId="image2" />

      {/* 右上：大号装饰数字编号 */}
      <div style={{ position: 'absolute', left: 613, top: 120, width: 120, height: 70, fontFamily: WEB_FONTS.playfair, fontWeight: 800, fontSize: 64, lineHeight: 1, color: COLORS.ink, overflow: 'hidden' }}>{d['label']}</div>

      {/* 竖排作者署名（rotate -90°，沿右半左缘自下而上） */}
      <div style={{ position: 'absolute', left: 443, top: 250, width: 160, height: 24, transform: 'rotate(-90deg)', transformOrigin: 'top left', fontFamily: WEB_FONTS.serifCn, fontSize: 19, lineHeight: 1, letterSpacing: '0.04em', color: COLORS.ink, whiteSpace: 'nowrap' }}>{d['explain']}</div>

      {/* 日期 */}
      <div style={{ position: 'absolute', left: 621, top: 189, width: 90, height: 24, fontFamily: WEB_FONTS.serifCn, fontSize: 19, lineHeight: 1, color: COLORS.ink, overflow: 'hidden' }}>{d['date']}</div>

      {/* 两行主标题 */}
      <div style={{ position: 'absolute', left: 495, top: 349, width: 160, height: 164, fontFamily: WEB_FONTS.serifCn, fontSize: 59, lineHeight: 1.25, color: COLORS.ink, whiteSpace: 'pre-wrap', overflow: 'hidden' }}>{d['title']}</div>

      {/* 结尾文案 */}
      <div style={{ position: 'absolute', left: 496, top: 592, width: 210, height: 110, fontFamily: WEB_FONTS.serifCn, fontSize: 19, lineHeight: 1.6, color: COLORS.ink, whiteSpace: 'pre-wrap', overflow: 'hidden' }}>{d['body']}</div>

      {/* ── 固定品牌落款（非槽位，同 mag-20；右下角） ── */}
      {/* 品牌 logo */}
      <img src={YUJEE_LOGO_SVG} alt="yujee" style={{ position: 'absolute', left: 629, top: 990, width: 112, height: 47, objectFit: 'contain', display: 'block' }} />
      {/* 版权 */}
      <div style={{ position: 'absolute', left: 629, top: 1047, width: 130, fontFamily: WEB_FONTS.sansEn, fontWeight: 400, fontSize: 16, lineHeight: 1, color: '#C2C2C2' }}>© {year} Yujee</div>
    </div>
  );
}
