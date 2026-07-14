import type { TemplateRenderProps } from '../types';
import { COLORS, fitDisplayFontSize, PAGE, WEB_FONTS } from '../constants';
import { WebImage } from '../web-utils';
import { resolveThemeCarrier } from '../theme-carrier';
import { contractRole } from '../contract-role';

// 封面（category: cover，1 图）。白底；大号宽体展示主标题 + 副标题叠于左上；
// 居中大封面图；右上「Year / City」两列固定标签 + 年份/城市列表（槽）；
// 右上角「M」角标 + 左上/中部装饰小方块均为固定 furniture、不进契约。
// 版式来自 Figma 稿（595×842 → ×1.3344 → 794×1123）。
// 原稿展示字 Audiowide（本地无）→ montserrat + letterSpacing 模拟宽体；PingFang/PuHuiTi → sansCn。

export function WebMag23({ data, imagePos }: TemplateRenderProps) {
  const d = data as Record<string, string>;
  const yearTheme = resolveThemeCarrier(data, 'body', contractRole('mag-23', 'body'));
  const cityTheme = resolveThemeCarrier(data, 'body2', contractRole('mag-23', 'body2'));
  const titleTheme = resolveThemeCarrier(data, 'title', contractRole('mag-23', 'title'));
  const subtitleTheme = resolveThemeCarrier(data, 'title2', contractRole('mag-23', 'title2'));
  return (
    <div style={{ position: 'relative', width: PAGE.width, height: PAGE.height, background: '#FFFFFF', overflow: 'hidden' }}>
      {/* ── 固定装饰：左上四个渐深小方块（furniture，非槽位） ── */}
      <div style={{ position: 'absolute', left: 67, top: 67, width: 13, height: 13, background: 'rgba(0,0,0,0.15)' }} />
      <div style={{ position: 'absolute', left: 81, top: 67, width: 13, height: 13, background: 'rgba(0,0,0,0.35)' }} />
      <div style={{ position: 'absolute', left: 95, top: 67, width: 13, height: 13, background: 'rgba(0,0,0,0.65)' }} />
      <div style={{ position: 'absolute', left: 108, top: 67, width: 13, height: 13, background: 'rgba(0,0,0,0.9)' }} />

      {/* ── 固定装饰：右上角「M」角标（furniture，非槽位） ── */}
      <div style={{ position: 'absolute', left: 723, top: 60, fontFamily: WEB_FONTS.sansCn, fontWeight: 700, fontSize: 16, lineHeight: 1, color: COLORS.ink }}>M</div>

      {/* ── 固定标签「Year」「City」（furniture，非槽位） ── */}
      <div style={{ position: 'absolute', left: 427, top: 125, fontFamily: WEB_FONTS.sansCn, fontWeight: 400, fontSize: 12, lineHeight: 1, color: COLORS.ink }}>Year</div>
      <div style={{ position: 'absolute', left: 536, top: 125, fontFamily: WEB_FONTS.sansCn, fontWeight: 400, fontSize: 12, lineHeight: 1, color: COLORS.ink }}>City</div>

      {/* ── 年份列表（槽 body，换行分隔） ── */}
      <div style={{ position: 'absolute', left: 467, top: 123, width: 60, fontFamily: yearTheme.webFontFamily, fontWeight: 300, fontSize: 12, lineHeight: 1.6, color: yearTheme.accentColor ?? COLORS.ink, whiteSpace: 'pre-wrap', overflow: 'hidden' }}>{d['body']}</div>

      {/* ── 城市列表（槽 body2，换行分隔） ── */}
      <div style={{ position: 'absolute', left: 576, top: 123, width: 130, fontFamily: cityTheme.webFontFamily, fontWeight: 300, fontSize: 12, lineHeight: 1.6, color: cityTheme.accentColor ?? COLORS.ink, whiteSpace: 'pre-wrap', overflow: 'hidden' }}>{d['body2']}</div>

      {/* ── 主标题（槽 title，宽体展示字；字号按行宽自适应,不再裁字） ── */}
      <div style={{ position: 'absolute', left: 57, top: 201, width: 400, height: 80, fontFamily: titleTheme.webFontFamily, fontWeight: 800, fontSize: fitDisplayFontSize(d['title'] ?? '', 380, 75, 32), lineHeight: 1, letterSpacing: '0.06em', color: titleTheme.accentColor ?? COLORS.ink, whiteSpace: 'pre-wrap', overflow: 'hidden' }}>{d['title']}</div>

      {/* ── 副标题（槽 title2，略小；同上自适应） ── */}
      <div style={{ position: 'absolute', left: 67, top: 287, width: 300, height: 56, fontFamily: subtitleTheme.webFontFamily, fontWeight: 800, fontSize: fitDisplayFontSize(d['title2'] ?? '', 285, 53, 24), lineHeight: 1, letterSpacing: '0.06em', color: subtitleTheme.accentColor ?? COLORS.ink, whiteSpace: 'pre-wrap', overflow: 'hidden' }}>{d['title2']}</div>

      {/* ── 固定装饰：中部小方块（furniture，非槽位） ── */}
      <div style={{ position: 'absolute', left: 354, top: 327, width: 13, height: 13, background: 'rgba(0,0,0,0.8)' }} />

      {/* ── 封面大图（槽 image，cover） ── */}
      <WebImage src={d['image']} style={{ position: 'absolute', left: 55, top: 353, width: 685, height: 728, objectFit: 'cover' }} position={imagePos?.['image']} slotId="image" />
    </div>
  );
}
