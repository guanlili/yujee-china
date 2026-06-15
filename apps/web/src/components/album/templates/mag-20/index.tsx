import type { TemplateRenderProps } from '../types';
import { COLORS, PAGE, WEB_FONTS } from '../constants';
import { WebImage } from '../web-utils';

// 杂志尾页（slot: ending）。Logo 字标与设计师署名为固定品牌元素，不参与数据填充。

export function WebMag20({ data }: TemplateRenderProps) {
  const d = data as Record<string, string>;
  return (
    <div style={{ position: 'relative', width: PAGE.width, height: PAGE.height, background: COLORS.paper, overflow: 'hidden' }}>
      {/* Logo 品牌字标（固定，不可编辑） */}
      <div style={{ position: 'absolute', left: 197, top: 100, width: 400, textAlign: 'center', fontSize: 30, fontFamily: WEB_FONTS.serifEn, color: COLORS.ink, letterSpacing: '0.4em', lineHeight: 1 }}>遇己</div>
      <div style={{ position: 'absolute', left: 197, top: 150, width: 400, textAlign: 'center', fontSize: 10, fontFamily: WEB_FONTS.serifEn, color: '#a09b8e', letterSpacing: '0.5em' }}>YUJEE</div>

      {/* 收尾图片 */}
      <WebImage src={d['image1']} style={{ position: 'absolute', left: 197, top: 212, width: 400, height: 460, objectFit: 'cover' }} />

      {/* 尾页文案（可编辑槽位） */}
      <div style={{ position: 'absolute', left: 137, top: 720, width: 520, fontSize: 16, fontFamily: WEB_FONTS.serifEn, color: '#5a574f', textAlign: 'center', lineHeight: 1.7, whiteSpace: 'pre-wrap', overflow: 'hidden' }}>{d['title']}</div>

      {/* 分隔细线 + 设计师署名（固定） */}
      <div style={{ position: 'absolute', left: 377, top: 980, width: 40, height: 1, background: '#a09b8e' }} />
      <div style={{ position: 'absolute', left: 197, top: 1000, width: 400, textAlign: 'center', fontSize: 13, fontFamily: WEB_FONTS.serifEn, color: '#a09b8e', letterSpacing: '0.25em' }}>设计 · 玉几</div>
    </div>
  );
}
