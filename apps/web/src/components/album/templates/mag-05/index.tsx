import { COLORS, WEB_FONTS } from '../constants';
import { WebFolio, WebImage, WebPage, brToReact } from '../web-utils';
import type { TemplateRenderProps } from '../types';
import { resolveThemeCarrier } from '../theme-carrier';

export function WebMag05({ data, totalPages, imagePos }: TemplateRenderProps) {
  const d = data as {
    title?: string;
    label?: string;
    explain?: string;
    folio?: string;
    image?: string;
  };
  const titleTheme = resolveThemeCarrier(data, 'title');
  const topRightTheme = resolveThemeCarrier(data, 'label');
  return (
    <WebPage fontFamily={WEB_FONTS.sansEn}>
      <h1
        style={{
          position: 'absolute',
          top: 96,
          left: 50,
          right: 240,
          margin: 0,
          fontFamily: titleTheme.webFontFamily ?? WEB_FONTS.bebas,
          fontSize: 88,
          letterSpacing: '0.02em',
          lineHeight: 0.92,
          fontWeight: 400,
          textTransform: 'uppercase',
          color: titleTheme.accentColor ?? COLORS.ink,
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
          fontFamily: topRightTheme.webFontFamily ?? WEB_FONTS.montserrat,
        }}
      >
        {topRightTheme.text ?? d.label ?? ''}
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
          {d.explain || ''}
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
