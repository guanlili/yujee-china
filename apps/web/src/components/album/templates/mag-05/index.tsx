import { COLORS, WEB_FONTS } from '../constants';
import { WebFolio, WebImage, WebPage, brToReact } from '../web-utils';
import type { TemplateRenderProps } from '../types';
import { resolveThemeCarrier } from '../theme-carrier';

export function WebMag05({ data, totalPages, imagePos }: TemplateRenderProps) {
  const d = data as {
    title?: string;
    topRight?: string;
    caption?: string;
    folio?: string;
    image?: string;
  };
  const titleTheme = resolveThemeCarrier(data, 'title');
  const topRightTheme = resolveThemeCarrier(data, 'topRight');
  return (
    <WebPage fontFamily={WEB_FONTS.sansEn}>
      <h1
        style={{
          position: 'absolute',
          top: 110,
          left: 50,
          right: 280,
          margin: 0,
          fontFamily: titleTheme.webFontFamily ?? WEB_FONTS.serifEn,
          fontSize: 44,
          letterSpacing: '0.04em',
          lineHeight: 1.15,
          fontWeight: 400,
          color: titleTheme.accentColor,
        }}
      >
        {brToReact(titleTheme.text ?? d.title ?? "LET'S GO RIDE\nA BIKE")}
      </h1>
      <div
        style={{
          position: 'absolute',
          top: 120,
          right: 50,
          width: 190,
          textAlign: 'right',
          fontSize: 13,
          letterSpacing: '0.3em',
          color: topRightTheme.accentColor ?? COLORS.ink2,
          textTransform: 'uppercase',
          fontFamily: topRightTheme.webFontFamily,
        }}
      >
        {topRightTheme.text ?? d.topRight ?? ''}
      </div>
      <div style={{ position: 'absolute', top: 290, left: 50, width: 320 }}>
        <p
          style={{
            margin: 0,
            lineHeight: 1.75,
            color: COLORS.ink2,
            textAlign: 'justify',
            letterSpacing: '0.02em',
            fontSize: 18,
          }}
        >
          {d.caption || ''}
        </p>
      </div>
      <WebImage
        src={d.image}
        placeholder="3:2"
        style={{ position: 'absolute', top: 430, left: 50, right: 50, height: 600 }}
        position={imagePos?.['image']}
        slotId="image"
      />
      <WebFolio folio={d.folio} totalPages={totalPages} fallback="05" />
    </WebPage>
  );
}
