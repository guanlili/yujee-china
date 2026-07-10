import { COLORS, WEB_FONTS } from '../constants';
import { WebFolio, WebImage, WebPage, brToReact } from '../web-utils';
import type { TemplateRenderProps } from '../types';
import { resolveThemeCarrier } from '../theme-carrier';

export function WebMag15({ data, totalPages, imagePos }: TemplateRenderProps) {
  const d = data as {
    image1?: string;
    image2?: string;
    body?: string;
    title?: string;
    date?: string;
    folio?: string;
  };
  const titleTheme = resolveThemeCarrier(data, 'title', 'title');
  const dateTheme = resolveThemeCarrier(data, 'date', 'decoration');
  const bodyTheme = resolveThemeCarrier(data, 'body', 'body');
  const folioTheme = resolveThemeCarrier(data, 'folio', 'decoration');
  return (
    <WebPage fontFamily={WEB_FONTS.sansEn}>
      <p
        style={{
          position: 'absolute',
          top: 90,
          left: 70,
          width: 280,
          margin: 0,
          lineHeight: 1.7,
          color: bodyTheme.accentColor ?? COLORS.ink2,
          fontFamily: bodyTheme.webFontFamily,
          letterSpacing: '0.02em',
          textAlign: 'justify',
          fontSize: 18,
        }}
      >
        {d.body || ''}
      </p>
      <WebImage
        src={d.image1}
        placeholder="3:4"
        style={{ position: 'absolute', top: 180, right: 70, width: 655, height: 440 }}
        position={imagePos?.['image1']}
        slotId="image1"
      />
      <WebImage
        src={d.image2}
        placeholder="4:3"
        style={{ position: 'absolute', top: 660, left: 70, width: 400, height: 350 }}
        position={imagePos?.['image2']}
        slotId="image2"
      />
      <h1
        style={{
          position: 'absolute',
          top: 690,
          right: 70,
          width: 460,
          margin: 0,
          textAlign: 'right',
          fontFamily: titleTheme.webFontFamily,
          fontWeight: 800,
          fontSize: 84,
          letterSpacing: '0.01em',
          lineHeight: 1.02,
          color: titleTheme.accentColor ?? COLORS.ink,
        }}
      >
        {brToReact(titleTheme.text ?? d.title ?? 'HAPPY\nCHOFU')}
      </h1>
      <div
        style={{
          position: 'absolute',
          bottom: 95,
          right: 72,
          fontSize: 11,
          letterSpacing: '0.3em',
          color: dateTheme.accentColor ?? COLORS.ink2,
          textTransform: 'uppercase',
          fontFamily: dateTheme.webFontFamily,
        }}
      >
        {dateTheme.text ?? d.date ?? ''}
      </div>
      <WebFolio folio={d.folio} totalPages={totalPages} accentColor={folioTheme.accentColor} fontFamily={folioTheme.webFontFamily} fallback="15" />
    </WebPage>
  );
}
