import { COLORS, WEB_FONTS } from '../constants';
import { WebFolio, WebImage, WebPage, brToReact } from '../web-utils';
import type { TemplateRenderProps } from '../types';
import { resolveThemeCarrier } from '../theme-carrier';

export function WebMag15({ data, totalPages, imagePos }: TemplateRenderProps) {
  const d = data as {
    imagePerson?: string;
    imageRoad?: string;
    body?: string;
    title?: string;
    date?: string;
    folio?: string;
  };
  const titleTheme = resolveThemeCarrier(data, 'title');
  const dateTheme = resolveThemeCarrier(data, 'date');
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
          color: COLORS.ink2,
          letterSpacing: '0.02em',
          textAlign: 'justify',
          fontSize: 18,
        }}
      >
        {d.body || ''}
      </p>
      <WebImage
        src={d.imagePerson}
        placeholder="3:4"
        style={{ position: 'absolute', top: 180, right: 70, width: 655, height: 440 }}
        position={imagePos?.['imagePerson']}
        slotId="imagePerson"
      />
      <WebImage
        src={d.imageRoad}
        placeholder="4:3"
        style={{ position: 'absolute', top: 660, left: 70, width: 400, height: 350 }}
        position={imagePos?.['imageRoad']}
        slotId="imageRoad"
      />
      <h1
        style={{
          position: 'absolute',
          top: 750,
          right: 70,
          margin: 0,
          textAlign: 'right',
          fontFamily: titleTheme.webFontFamily ?? WEB_FONTS.serifEn,
          fontWeight: 400,
          fontSize: 54,
          letterSpacing: '0.10em',
          lineHeight: 1.1,
          color: titleTheme.accentColor,
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
      <WebFolio folio={d.folio} totalPages={totalPages} fallback="15" />
    </WebPage>
  );
}
