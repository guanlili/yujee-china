import type { TemplateRenderProps } from '../types';
import { PAGE, WEB_FONTS } from '../constants';
import { WebImage } from '../web-utils';
import { resolveThemeCarrier } from '../theme-carrier';
import { contractRole } from '../contract-role';

// 内页 · 双栏记事页（category: interior，2 图）。白底；对角布局 ——
// 左上竖图贴左缘配右侧正文（body），右下大竖图配左侧窄栏正文（body2）。
// 版式来自「排版板式」Figma 稿 A4 - 32（node 50:31，595×842 → ×1.3344 → 794×1123）。
// 字体默认值与 HTML 模板 token 回退语义一致：设了 artFont 才走主题栈，否则用模板默认栈。

const INK = '#1c1b18';

export function WebMag61({ data, imagePos }: TemplateRenderProps) {
  const d = data as Record<string, string>;
  const bodyTheme = resolveThemeCarrier(data, 'body', contractRole('mag-61', 'body'));
  const body2Theme = resolveThemeCarrier(data, 'body2', contractRole('mag-61', 'body2'));
  return (
    <div style={{ position: 'relative', width: PAGE.width, height: PAGE.height, background: '#FFFFFF', overflow: 'hidden' }}>
      {/* 左上竖图（贴左缘） */}
      <WebImage src={d['image1']} style={{ position: 'absolute', left: 0, top: 139, width: 286, height: 379, objectFit: 'cover' }} position={imagePos?.['image1']} slotId="image1" />
      {/* 右上正文（与左图同顶线） */}
      <div style={{ position: 'absolute', left: 346, top: 139, width: 376, height: 363, fontFamily: bodyTheme.artFont ? bodyTheme.webFontFamily : WEB_FONTS.sansEn, fontWeight: 500, fontSize: 19, lineHeight: 1.36, color: bodyTheme.accentColor ?? INK, whiteSpace: 'pre-wrap', overflow: 'hidden' }}>{d['body']}</div>

      {/* 右下大竖图（与上方正文同左线） */}
      <WebImage src={d['image2']} style={{ position: 'absolute', left: 346, top: 630, width: 396, height: 440, objectFit: 'cover' }} position={imagePos?.['image2']} slotId="image2" />
      {/* 左下窄栏正文 */}
      <div style={{ position: 'absolute', left: 32, top: 653, width: 254, height: 418, fontFamily: body2Theme.artFont ? body2Theme.webFontFamily : WEB_FONTS.sansEn, fontWeight: 500, fontSize: 19, lineHeight: 1.36, color: body2Theme.accentColor ?? INK, whiteSpace: 'pre-wrap', overflow: 'hidden' }}>{d['body2']}</div>
    </div>
  );
}
