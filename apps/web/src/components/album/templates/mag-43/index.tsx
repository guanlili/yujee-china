import type { TemplateRenderProps } from '../types';
import { PAGE, WEB_FONTS } from '../constants';
import { WebImage } from '../web-utils';
import { resolveThemeCarrier } from '../theme-carrier';

// 内页 · 拼贴大字内页（category: interior，5 图）。来自 A4-15 (node 11:521)。白底；
// 上半部右侧 / 左中错落 3 张竖图拼贴 + 图注段落，下半部「Notes / from Elsewhere」大字标题，
// 底部左右两张方图收尾。全套文字 #1c1b18、字体 Inter(sansEn)。
// 版式：595×842 → ×1.3344 → 794×1123。

const INK = '#1c1b18';

export function WebMag43({ data, imagePos }: TemplateRenderProps) {
  const d = data as Record<string, string>;
  const captionTheme = resolveThemeCarrier(data, 'caption');
  const titleTheme = resolveThemeCarrier(data, 'title');
  const subtitleTheme = resolveThemeCarrier(data, 'subtitle');
  return (
    <div style={{ position: 'relative', width: PAGE.width, height: PAGE.height, background: '#FFFFFF', overflow: 'hidden' }}>
      {/* 上半部拼贴：右大竖图 + 左中两竖图 */}
      <WebImage src={d['image1']} style={{ position: 'absolute', left: 438, top: 28, width: 328, height: 431, objectFit: 'cover' }} position={imagePos?.['image1']} slotId="image1" />
      <WebImage src={d['image2']} style={{ position: 'absolute', left: 221, top: 28, width: 195, height: 271, objectFit: 'cover' }} position={imagePos?.['image2']} slotId="image2" />
      <WebImage src={d['image3']} style={{ position: 'absolute', left: 40, top: 291, width: 181, height: 268, objectFit: 'cover' }} position={imagePos?.['image3']} slotId="image3" />

      {/* 右上拼贴下方图注段落 */}
      <div style={{ position: 'absolute', left: 444, top: 466, width: 334, fontFamily: WEB_FONTS.sansEn, fontWeight: 400, fontSize: 19, lineHeight: 1.4, color: captionTheme.accentColor ?? INK, whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflow: 'hidden' }}>{d['caption']}</div>

      {/* 下半部大字标题（主标题 + 续行） */}
      <div style={{ position: 'absolute', left: 418, top: 647, width: 360, fontFamily: WEB_FONTS.sansEn, fontWeight: 800, fontSize: 88, lineHeight: 1.0, color: titleTheme.accentColor ?? INK, whiteSpace: 'pre-wrap', overflow: 'hidden' }}>{d['title']}</div>
      <div style={{ position: 'absolute', left: 128, top: 767, width: 650, fontFamily: WEB_FONTS.sansEn, fontWeight: 800, fontSize: 80, lineHeight: 1.0, color: subtitleTheme.accentColor ?? INK, whiteSpace: 'pre-wrap', overflow: 'hidden' }}>{d['subtitle']}</div>

      {/* 底部左右两张方图 */}
      <WebImage src={d['image4']} style={{ position: 'absolute', left: 221, top: 901, width: 181, height: 184, objectFit: 'cover' }} position={imagePos?.['image4']} slotId="image4" />
      <WebImage src={d['image5']} style={{ position: 'absolute', left: 584, top: 901, width: 181, height: 184, objectFit: 'cover' }} position={imagePos?.['image5']} slotId="image5" />
    </div>
  );
}
