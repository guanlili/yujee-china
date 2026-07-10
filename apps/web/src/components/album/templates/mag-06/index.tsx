import { WEB_FONTS } from '../constants';
import { WebFolio, WebImage, WebPage } from '../web-utils';
import type { TemplateRenderProps } from '../types';
import { resolveThemeCarrier } from '../theme-carrier';

export function WebMag06({ data, totalPages, imagePos }: TemplateRenderProps) {
  const d = data as { folio?: string; image?: string };
  const folioTheme = resolveThemeCarrier(data, 'folio', 'decoration');
  return (
    <WebPage fontFamily={WEB_FONTS.sansEn}>
      <WebImage
        src={d.image}
        placeholder="3:4"
        style={{ position: 'absolute', left: 83, top: 90, width: 628, height: 943 }}
        position={imagePos?.['image']}
        slotId="image"
      />
      <WebFolio folio={d.folio} totalPages={totalPages} accentColor={folioTheme.accentColor} fontFamily={folioTheme.webFontFamily} fallback="06" />
    </WebPage>
  );
}
