import type { TemplateRenderProps } from '../types';
import { COLORS, PAGE } from '../constants';
import { WebImage } from '../web-utils';
import { resolveThemeCarrier } from '../theme-carrier';

// 内页 · 杂志风（category: interior，1 图）。白底；左上宽体大标题，右上小标题 + 导语，
// 中部一张横图，下方日期 / 图注 / 页脚小字。左上角固定汉堡图标（两根横条）是 furniture，不进契约。
// 版式来自 Figma 稿（595×842 → ×1.3344 → 794×1123）。
// 字体顶替：Audiowide（宽体展示字本地没有）→ montserrat(800 + letterSpacing 模拟宽体)；PingFang SC → sansCn。

const HAMBURGER = '#656565';

export function WebMag27({ data, imagePos }: TemplateRenderProps) {
  const d = data as Record<string, string>;
  const titleTheme = resolveThemeCarrier(data, 'title', 'title');
  const explain1Theme = resolveThemeCarrier(data, 'explain1', 'explain');
  const bodyTheme = resolveThemeCarrier(data, 'body', 'body');
  const dateTheme = resolveThemeCarrier(data, 'date', 'decoration');
  const explain2Theme = resolveThemeCarrier(data, 'explain2', 'explain');
  const label1Theme = resolveThemeCarrier(data, 'label1', 'decoration');
  const label2Theme = resolveThemeCarrier(data, 'label2', 'decoration');
  return (
    <div style={{ position: 'relative', width: PAGE.width, height: PAGE.height, background: '#FFFFFF', overflow: 'hidden' }}>
      {/* 左上角固定汉堡图标（两根横条，furniture） */}
      <div style={{ position: 'absolute', left: 63, top: 59, width: 23, height: 3, background: HAMBURGER }} />
      <div style={{ position: 'absolute', left: 63, top: 65, width: 23, height: 3, background: HAMBURGER }} />

      {/* 左上大标题（宽体展示字，两行） */}
      <div style={{ position: 'absolute', left: 63, top: 116, width: 335, height: 192, fontFamily: titleTheme.webFontFamily, fontWeight: 800, fontSize: 75, lineHeight: 1.1, letterSpacing: '0.04em', color: titleTheme.accentColor ?? COLORS.ink, whiteSpace: 'pre-wrap', overflow: 'hidden' }}>{d['title']}</div>

      {/* 右上小标题 / 导语 */}
      <div style={{ position: 'absolute', left: 430, top: 108, width: 144, height: 65, fontFamily: explain1Theme.webFontFamily, fontWeight: 500, fontSize: 21, lineHeight: 1.3, color: explain1Theme.accentColor ?? COLORS.ink, whiteSpace: 'pre-wrap', overflow: 'hidden' }}>{d['explain1']}</div>

      {/* 右上正文导语 */}
      <div style={{ position: 'absolute', left: 430, top: 212, width: 310, height: 72, fontFamily: bodyTheme.webFontFamily, fontWeight: 400, fontSize: 19, lineHeight: 1.4, color: bodyTheme.accentColor ?? COLORS.ink, whiteSpace: 'pre-wrap', overflow: 'hidden' }}>{d['body']}</div>

      {/* 中部横图 */}
      <WebImage src={d['image']} style={{ position: 'absolute', left: 55, top: 353, width: 685, height: 476, objectFit: 'cover' }} position={imagePos?.['image']} slotId="image" />

      {/* 日期 */}
      <div style={{ position: 'absolute', left: 55, top: 840, fontFamily: dateTheme.webFontFamily, fontWeight: 400, fontSize: 19, lineHeight: 1, color: dateTheme.accentColor ?? COLORS.ink }}>{d['date']}</div>

      {/* 图注 */}
      <div style={{ position: 'absolute', left: 55, top: 878, width: 232, fontFamily: explain2Theme.webFontFamily, fontWeight: 400, fontSize: 19, lineHeight: 1.3, color: explain2Theme.accentColor ?? COLORS.ink, overflow: 'hidden' }}>{d['explain2']}</div>

      {/* 右侧标签 */}
      <div style={{ position: 'absolute', left: 698, top: 834, fontFamily: label1Theme.webFontFamily, fontWeight: 400, fontSize: 19, lineHeight: 1, color: label1Theme.accentColor ?? COLORS.ink }}>{d['label1']}</div>

      {/* 底部页脚小字 */}
      <div style={{ position: 'absolute', left: 316, top: 996, fontFamily: label2Theme.webFontFamily, fontWeight: 400, fontSize: 16, lineHeight: 1, color: label2Theme.accentColor ?? COLORS.ink }}>{d['label2']}</div>
    </div>
  );
}
