import { COLORS, WEB_FONTS } from '../constants';
import { WebFolio, WebImage, WebPage } from '../web-utils';
import type { TemplateRenderProps } from '../types';
import { resolveThemeCarrier } from '../theme-carrier';

export function WebMag03({ data, totalPages, imagePos }: TemplateRenderProps) {
  const d = data as {
    location?: string;
    folio?: string;
    image?: string;
  };
  const locationTheme = resolveThemeCarrier(data, 'location');
  return (
    <WebPage fontFamily={WEB_FONTS.sansEn}>
      <WebImage
        src={d.image}
        placeholder="3:4"
        style={{ position: 'absolute', top: 80, left: 50, right: 50, height: 925 }}
        position={imagePos?.['image']}
        slotId="image"
      />
      <div
        style={{
          position: 'absolute',
          bottom: 50,
          left: 50,
          right: 50,
        }}
      >
        <div
          style={{
            letterSpacing: '0.3em',
            color: locationTheme.accentColor ?? COLORS.ink,
            textTransform: 'uppercase',
            fontSize: 16,
            fontFamily: locationTheme.webFontFamily,
          }}
        >
          {locationTheme.text ?? d.location ?? ''}
        </div>
      </div>
      <WebFolio folio={d.folio} totalPages={totalPages} fallback="03" />
    </WebPage>
  );
}
