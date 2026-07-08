import { COLORS, WEB_FONTS } from '../constants';
import { WebFolio, WebImage, WebPage } from '../web-utils';
import type { TemplateRenderProps } from '../types';
import { resolveThemeCarrier } from '../theme-carrier';

export function WebMag08({ data, totalPages, imagePos }: TemplateRenderProps) {
  const d = data as {
    image?: string;
    date?: string;
    explain1?: string;
    explain2?: string;
    title?: string;
    folio?: string;
  };
  const dateTheme = resolveThemeCarrier(data, 'date');
  const titleTheme = resolveThemeCarrier(data, 'title');
  const explain1Theme = resolveThemeCarrier(data, 'explain1');
  const explain2Theme = resolveThemeCarrier(data, 'explain2');
  const folioTheme = resolveThemeCarrier(data, 'folio');
  const dn = (d.date || '08/24').split('/');
  return (
    <WebPage fontFamily={WEB_FONTS.sansEn}>
      <div
        style={{
          position: 'absolute',
          top: 90,
          right: 70,
          fontFamily: dateTheme.webFontFamily ?? WEB_FONTS.serifEn,
          fontStyle: 'italic',
          fontSize: 46,
          color: dateTheme.accentColor ?? COLORS.ink,
          lineHeight: 1,
          letterSpacing: '0.02em',
        }}
      >
        {dn[0]}
        <span style={{ color: dateTheme.accentColor ?? COLORS.ink2 }}>/</span>
        {dn[1]}
      </div>
      <WebImage
        src={d.image}
        placeholder="4:5"
        style={{ position: 'absolute', left: 70, top: 100, width: 360, height: 550 }}
        position={imagePos?.['image']}
        slotId="image"
      />
      {/* 左侧说明：与照片左缘对齐、宽度等于照片宽度 */}
      <p
        style={{ position: 'absolute', left: 70, top: 670, width: 360, height: 24, fontSize: 18,
          fontFamily: WEB_FONTS.montserrat,
          lineHeight: 1.7,
          color: explain1Theme.accentColor ?? COLORS.ink2,
          letterSpacing: '0.04em',
          textAlign: 'justify' }}
      >
        {d.explain1 || ''}
      </p>
      {/* 右侧说明：移到照片右缘之外、收窄宽度，避免与照片重叠；分两段渲染 */}
      <div
        style={{ position: 'absolute', left: 470, top: 300, width: 250, fontSize: 16,
          fontFamily: WEB_FONTS.montserrat,
          lineHeight: 1.7,
          color: explain2Theme.accentColor ?? COLORS.ink2,
          letterSpacing: '0.04em',
          textAlign: 'justify' }}
      >
        {(d.explain2 || '').split('\n\n').map((para, i) => (
          <p key={i} style={{ margin: i === 0 ? 0 : '14px 0 0' }}>{para}</p>
        ))}
      </div>
      <h1
        style={{ position: 'absolute', left: 70, top: 920, width: 280, height: 96,
          fontWeight: 400,
          fontSize: 78,
          letterSpacing: '0.01em',
          lineHeight: 1.05,
          color: titleTheme.accentColor ?? COLORS.ink,
          fontFamily: titleTheme.webFontFamily ?? WEB_FONTS.abril,
          overflow: 'hidden' }}
      >
        {titleTheme.text ?? d.title ?? 'EVENT'}
      </h1>
      <WebFolio folio={d.folio} totalPages={totalPages} accentColor={folioTheme.accentColor} fallback="08" />
    </WebPage>
  );
}
