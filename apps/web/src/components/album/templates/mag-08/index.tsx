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
    body?: string;
    folio?: string;
  };
  const dateTheme = resolveThemeCarrier(data, 'date');
  const titleTheme = resolveThemeCarrier(data, 'title');
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
          lineHeight: 1.7,
          color: COLORS.ink2,
          letterSpacing: '0.02em',
          textAlign: 'justify' }}
      >
        {d.explain1 || ''}
      </p>
      {/* 右侧说明：移到照片右缘之外、收窄宽度，避免与照片重叠 */}
      <p
        style={{ position: 'absolute', left: 470, top: 670, width: 250, height: 24, fontSize: 18,
          lineHeight: 1.7,
          color: COLORS.ink2,
          letterSpacing: '0.02em',
          textAlign: 'justify' }}
      >
        {d.explain2 || ''}
      </p>
      <h1
        style={{ position: 'absolute', left: 70, top: 968, width: 244, height: 60,
          fontWeight: 400,
          fontSize: 60,
          letterSpacing: '0.08em',
          lineHeight: 1,
          color: titleTheme.accentColor ?? COLORS.ink,
          fontFamily: titleTheme.webFontFamily ?? WEB_FONTS.serifEn }}
      >
        {titleTheme.text ?? d.title ?? 'EVENT'}
      </h1>
      {/* 标题右侧补一段长文字，填补 Event 右边的空缺 */}
      <p
        style={{ position: 'absolute', left: 360, top: 970, width: 360, height: 20, fontSize: 13,
          lineHeight: 1.55,
          color: COLORS.ink2,
          letterSpacing: '0.02em',
          textAlign: 'justify' }}
      >
        {d.body || ''}
      </p>
      <WebFolio folio={d.folio} totalPages={totalPages} fallback="08" />
    </WebPage>
  );
}
