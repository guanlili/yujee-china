import type { TemplateRenderProps } from '../types';
import { COLORS, PAGE, WEB_FONTS } from '../constants';
import { WebImage } from '../web-utils';

// 封面（category: cover，1 图）。白底；大号宽体展示主标题 + 副标题叠于左上；
// 居中大封面图；右上「Year / City」两列固定标签 + 年份/城市列表（槽）；
// 右上角「M」角标 + 左上/中部装饰小方块均为固定 furniture、不进契约。
// 版式来自 Figma 稿（595×842 → ×1.3344 → 794×1123）。
// 原稿展示字 Audiowide（本地无）→ montserrat + letterSpacing 模拟宽体；PingFang/PuHuiTi → sansCn。

export function WebMag23({ data, imagePos }: TemplateRenderProps) {
  const d = data as Record<string, string>;
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

      {/* ── 年份列表（槽 year，换行分隔） ── */}
      <div style={{ position: 'absolute', left: 467, top: 123, width: 60, fontFamily: WEB_FONTS.sansCn, fontWeight: 300, fontSize: 12, lineHeight: 1.6, color: COLORS.ink, whiteSpace: 'pre-wrap', overflow: 'hidden' }}>{d['year']}</div>

      {/* ── 城市列表（槽 city，换行分隔） ── */}
      <div style={{ position: 'absolute', left: 576, top: 123, width: 130, fontFamily: WEB_FONTS.sansCn, fontWeight: 300, fontSize: 12, lineHeight: 1.6, color: COLORS.ink, whiteSpace: 'pre-wrap', overflow: 'hidden' }}>{d['city']}</div>

      {/* ── 主标题（槽 title，宽体展示字） ── */}
      <div style={{ position: 'absolute', left: 57, top: 201, width: 400, height: 80, fontFamily: WEB_FONTS.montserrat, fontWeight: 800, fontSize: 75, lineHeight: 1, letterSpacing: '0.06em', color: COLORS.ink, whiteSpace: 'pre-wrap', overflow: 'hidden' }}>{d['title']}</div>

      {/* ── 副标题（槽 subtitle，略小） ── */}
      <div style={{ position: 'absolute', left: 67, top: 287, width: 300, height: 56, fontFamily: WEB_FONTS.montserrat, fontWeight: 800, fontSize: 53, lineHeight: 1, letterSpacing: '0.06em', color: COLORS.ink, whiteSpace: 'pre-wrap', overflow: 'hidden' }}>{d['subtitle']}</div>

      {/* ── 固定装饰：中部小方块（furniture，非槽位） ── */}
      <div style={{ position: 'absolute', left: 354, top: 327, width: 13, height: 13, background: 'rgba(0,0,0,0.8)' }} />

      {/* ── 封面大图（槽 image，cover） ── */}
      <WebImage src={d['image']} style={{ position: 'absolute', left: 55, top: 353, width: 685, height: 728, objectFit: 'cover' }} position={imagePos?.['image']} slotId="image" />
    </div>
  );
}
