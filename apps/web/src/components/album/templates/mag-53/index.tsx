import type { TemplateRenderProps } from '../types';
import { PAGE, WEB_FONTS } from '../constants';
import { WebImage } from '../web-utils';
import { resolveThemeCarrier } from '../theme-carrier';

// 内页 · 跨页大图叠字右半页（category: interior，1 图）。来自 A4-7 跨页 (node 11:271) 右半页
// （x 减 595）。原稿是 1190 宽的左右双 A4 拼版，本模板只复刻右半页 x∈[595,1190]：
// 右页本地坐标 = (figmaX - 595) ×1.3344，y/w/h 直接 ×1.3344。跨页大图(11:311)与跨页大标题
// (11:327)的主体落在右页，左溢出部分由最外层 overflow hidden 裁掉（故二者均为负 left）。
// 标准 A4 794×1123；白底；文字陶土黑 #1c1b18、Inter（sansEn）。

const INK = '#1c1b18';

export function WebMag53({ data, imagePos }: TemplateRenderProps) {
  const d = data as Record<string, string>;
  const title = d['title'] || 'Notes from Elsewhere';
  const titleTheme = resolveThemeCarrier(data, 'title');
  return (
    <div style={{ position: 'relative', width: PAGE.width, height: PAGE.height, background: '#FFFFFF', overflow: 'hidden' }}>
      {/* 跨页大图右片段（槽 image，11:311；负 left 由 overflow 裁掉左溢出，右页显示其右段） */}
      <WebImage src={d['image']} style={{ position: 'absolute', left: -180, top: 61, width: 907, height: 1001, objectFit: 'cover' }} position={imagePos?.['image']} slotId="image" />

      {/* 跨页大标题右片段（槽 title，11:327；负 left 裁切，显示右片段大展示字） */}
      <div style={{ position: 'absolute', left: -180, top: 823, width: 1265, height: 346, fontFamily: WEB_FONTS.sansEn, fontWeight: 400, fontSize: 120, lineHeight: 1.05, color: titleTheme.accentColor ?? INK, whiteSpace: 'pre-wrap', overflow: 'hidden' }}>{title}</div>
    </div>
  );
}
