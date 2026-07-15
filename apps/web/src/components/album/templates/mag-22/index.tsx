import type { TemplateRenderProps } from '../types';
import { COLORS, PAGE, WEB_FONTS } from '../constants';
import { WebImage } from '../web-utils';
import { YUJEE_LOGO_SVG } from '../brand-logo';
import { resolveThemeCarrier } from '../theme-carrier';
import { contractRole } from '../contract-role';

// 内页 · 故事合集（category: interior，2 图）。白底；顶部合集主标题；
// 两组「左图 + 右段落 + 作者署名」纵向排列；底部固定品牌落款（logo + 版权 + 社媒图标）。
// 版式来自 Figma 稿（595×842 → ×1.3344 → 794×1123）。品牌落款是固定 furniture、不进契约（同 mag-20）。

const BRAND_INK = '#292929';

export function WebMag22({ data, imagePos }: TemplateRenderProps) {
  const d = data as Record<string, string>;
  const year = new Date().getFullYear();
  const titleTheme = resolveThemeCarrier(data, 'title', contractRole('mag-22', 'title'));
  const body1Theme = resolveThemeCarrier(data, 'body', contractRole('mag-22', 'body'));
  const title21Theme = resolveThemeCarrier(data, 'title2', contractRole('mag-22', 'title2'));
  const body2Theme = resolveThemeCarrier(data, 'body2', contractRole('mag-22', 'body2'));
  const title3Theme = resolveThemeCarrier(data, 'title3', contractRole('mag-22', 'title3'));
  return (
    <div style={{ position: 'relative', width: PAGE.width, height: PAGE.height, background: '#FFFFFF', overflow: 'hidden' }}>
      {/* 合集主标题 */}
      <div style={{ position: 'absolute', left: 271, top: 95, width: 480, height: 80, fontFamily: titleTheme.webFontFamily, fontWeight: 800, fontSize: 60, lineHeight: 1.1, color: titleTheme.accentColor ?? COLORS.ink, whiteSpace: 'pre-wrap', overflow: 'hidden' }}>{d['title']}</div>

      {/* 故事一：图 + 正文 + 署名 */}
      <WebImage src={d['image1']} style={{ position: 'absolute', left: 72, top: 272, width: 240, height: 249, objectFit: 'cover' }} position={imagePos?.['image1']} slotId="image1" />
      <div style={{ position: 'absolute', left: 354, top: 296, width: 314, height: 170, fontFamily: body1Theme.webFontFamily, fontSize: 18, lineHeight: 1.6, color: body1Theme.accentColor ?? COLORS.ink, whiteSpace: 'pre-wrap', overflow: 'hidden' }}>{d['body']}</div>
      <div style={{ position: 'absolute', left: 352, top: 478, width: 304, height: 28, fontFamily: title21Theme.webFontFamily, fontWeight: 700, fontSize: 24, lineHeight: 1.1, color: title21Theme.accentColor ?? COLORS.ink, overflow: 'hidden' }}>{d['title2']}</div>

      {/* 故事二：图 + 正文 + 署名 */}
      <WebImage src={d['image2']} style={{ position: 'absolute', left: 72, top: 536, width: 240, height: 244, objectFit: 'cover' }} position={imagePos?.['image2']} slotId="image2" />
      <div style={{ position: 'absolute', left: 351, top: 558, width: 314, height: 170, fontFamily: body2Theme.webFontFamily, fontSize: 18, lineHeight: 1.6, color: body2Theme.accentColor ?? COLORS.ink, whiteSpace: 'pre-wrap', overflow: 'hidden' }}>{d['body2']}</div>
      <div style={{ position: 'absolute', left: 354, top: 738, width: 304, height: 28, fontFamily: title3Theme.webFontFamily, fontWeight: 700, fontSize: 24, lineHeight: 1.1, color: title3Theme.accentColor ?? COLORS.ink, overflow: 'hidden' }}>{d['title3']}</div>

      {/* ── 固定品牌落款（非槽位，同 mag-20） ── */}
      {/* 左下角：品牌 logo */}
      <img src={YUJEE_LOGO_SVG} alt="yujee" style={{ position: 'absolute', left: 56, top: 979, width: 112, height: 47, objectFit: 'contain', display: 'block' }} />
      {/* 左下角：版权 */}
      <div style={{ position: 'absolute', left: 56, top: 1038, width: 140, fontFamily: WEB_FONTS.sansEn, fontWeight: 400, fontSize: 16, lineHeight: 1, color: '#C2C2C2' }}>©  {year} Yujee</div>
      {/* 右下角：Instagram 图标（描边） */}
      <svg viewBox="0 0 24 24" width={32} height={32} fill="none" style={{ position: 'absolute', left: 646, top: 992 }}>
        <rect x="2.5" y="2.5" width="19" height="19" rx="5.2" stroke={BRAND_INK} strokeWidth={1.8} />
        <circle cx="12" cy="12" r="4.2" stroke={BRAND_INK} strokeWidth={1.8} />
        <circle cx="17.5" cy="6.5" r="1.15" fill={BRAND_INK} />
      </svg>
      {/* 右下角：X 图标 */}
      <svg viewBox="0 0 24 24" width={32} height={32} style={{ position: 'absolute', left: 699, top: 992 }}>
        <path d="M18.244 2H21.5L14 10.57L23 22H16.17L11.15 15.44L5.4 22H2.14L10.16 12.83L1.5 2H8.49L13.03 8L18.24 2H18.244ZM17.044 20H18.854L7.04 3.88H5.1L17.044 20Z" fill={BRAND_INK} />
      </svg>
    </div>
  );
}
