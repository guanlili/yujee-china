import type { TemplateRenderProps } from '../types';
import { PAGE, WEB_FONTS } from '../constants';
import { WebImage } from '../web-utils';
import { resolveThemeCarrier } from '../theme-carrier';
import { contractRole } from '../contract-role';

// 内页 · 记事页（category: interior，2 图）。白底；左上竖图贴左缘 + 右侧大竖图贴右缘，
// 下方左对齐日期小字（label）/ 手写体大标题 / 一段正文。
// 版式来自「排版板式」Figma 稿 A4 - 31（node 42:3，595×842 → ×1.3344 → 794×1123）。
// Figma 标题字体 Alex Brush 不在项目字体目录，取目录内最接近的手写体 Great Vibes。
// 字体默认值与 HTML 模板 token 回退语义一致：设了 artFont 才走主题栈，否则用模板默认栈
// （role 默认栈会把 label 解析成艺术字、title 解析成衬线，均与本版式设计稿不符）。

const INK = '#1c1b18';

export function WebMag60({ data, imagePos }: TemplateRenderProps) {
  const d = data as Record<string, string>;
  const titleTheme = resolveThemeCarrier(data, 'title', contractRole('mag-60', 'title'));
  const bodyTheme = resolveThemeCarrier(data, 'body', contractRole('mag-60', 'body'));
  const labelTheme = resolveThemeCarrier(data, 'label', contractRole('mag-60', 'label'));
  return (
    <div style={{ position: 'relative', width: PAGE.width, height: PAGE.height, background: '#FFFFFF', overflow: 'hidden' }}>
      {/* 左上竖图（贴左缘） */}
      <WebImage src={d['image1']} style={{ position: 'absolute', left: 0, top: 0, width: 286, height: 379, objectFit: 'cover' }} position={imagePos?.['image1']} slotId="image1" />
      {/* 右侧大竖图（贴右缘） */}
      <WebImage src={d['image2']} style={{ position: 'absolute', left: 398, top: 85, width: 396, height: 508, objectFit: 'cover' }} position={imagePos?.['image2']} slotId="image2" />

      {/* 日期小字（装饰标签） */}
      <div style={{ position: 'absolute', left: 91, top: 594, width: 232, height: 33, fontFamily: labelTheme.artFont ? labelTheme.webFontFamily : WEB_FONTS.sansEn, fontWeight: 500, fontSize: 19, lineHeight: 1.3, color: labelTheme.accentColor ?? INK, whiteSpace: 'pre-wrap', overflow: 'hidden' }}>{d['label']}</div>

      {/* 手写体大标题 */}
      <div style={{ position: 'absolute', left: 91, top: 639, width: 464, height: 188, fontFamily: titleTheme.artFont ? titleTheme.webFontFamily : WEB_FONTS.greatVibes, fontWeight: 400, fontSize: 67, lineHeight: 1.25, color: titleTheme.accentColor ?? INK, whiteSpace: 'pre-wrap', overflow: 'hidden' }}>{d['title']}</div>

      {/* 正文 */}
      <div style={{ position: 'absolute', left: 91, top: 827, width: 648, height: 238, fontFamily: bodyTheme.artFont ? bodyTheme.webFontFamily : WEB_FONTS.sansEn, fontWeight: 500, fontSize: 19, lineHeight: 1.36, color: bodyTheme.accentColor ?? INK, whiteSpace: 'pre-wrap', overflow: 'hidden' }}>{d['body']}</div>
    </div>
  );
}
