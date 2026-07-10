import type { TemplateRenderProps } from '../types';
import { PAGE } from '../constants';
import { WebImage } from '../web-utils';
import { resolveThemeCarrier } from '../theme-carrier';

// 内页 · 旅行相册六宫格（category: interior，6 图）。白底；2 行 ×3 列等大竖图，
// 行优先编号 image1..image6（上排左→右，下排左→右）；底部居中图注（body）。
// 全套文字陶土红 #1c1b18、字体 Inter(sansEn)。
// 版式来自 Figma 旅行相册稿 A4-11（595×842 → ×1.3344 → 794×1123）。

const TERRACOTTA = '#1c1b18';

// 六宫格几何（图槽 ~172×263 → 230×351）：上排 y28、下排 y403；列 x27/x283/x538。
const CELL_W = 230;
const CELL_H = 351;
const COLS = [27, 283, 538];
const ROW_TOP = 28;
const ROW_BOTTOM = 403;

export function WebMag31({ data, imagePos }: TemplateRenderProps) {
  const d = data as Record<string, string>;
  const bodyTheme = resolveThemeCarrier(data, 'body', 'body');
  return (
    <div style={{ position: 'relative', width: PAGE.width, height: PAGE.height, background: '#FFFFFF', overflow: 'hidden' }}>
      {/* 上排：image1 / image2 / image3 */}
      <WebImage src={d['image1']} style={{ position: 'absolute', left: 27, top: 28, width: 230, height: 351, objectFit: 'cover' }} position={imagePos?.['image1']} slotId="image1" />
      <WebImage src={d['image2']} style={{ position: 'absolute', left: 283, top: 28, width: 230, height: 351, objectFit: 'cover' }} position={imagePos?.['image2']} slotId="image2" />
      <WebImage src={d['image3']} style={{ position: 'absolute', left: 538, top: 28, width: 230, height: 351, objectFit: 'cover' }} position={imagePos?.['image3']} slotId="image3" />

      {/* 下排：image4 / image5 / image6 */}
      <WebImage src={d['image4']} style={{ position: 'absolute', left: 27, top: 403, width: 230, height: 351, objectFit: 'cover' }} position={imagePos?.['image4']} slotId="image4" />
      <WebImage src={d['image5']} style={{ position: 'absolute', left: 283, top: 403, width: 230, height: 351, objectFit: 'cover' }} position={imagePos?.['image5']} slotId="image5" />
      <WebImage src={d['image6']} style={{ position: 'absolute', left: 538, top: 403, width: 230, height: 351, objectFit: 'cover' }} position={imagePos?.['image6']} slotId="image6" />

      {/* 底部居中图注 */}
      <div style={{ position: 'absolute', left: 167, top: 800, width: 460, height: 180, fontFamily: bodyTheme.webFontFamily, fontSize: 18, lineHeight: 1.5, color: bodyTheme.accentColor ?? TERRACOTTA, textAlign: 'center', whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflow: 'hidden' }}>{d['body']}</div>
    </div>
  );
}
