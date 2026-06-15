import { WEB_FONTS } from '../constants';
import { WebFolio, WebImage, WebPage } from '../web-utils';
import type { TemplateRenderProps } from '../types';

export function WebMag06({ data, totalPages }: TemplateRenderProps) {
  const d = data as { folio?: string; image?: string };
  return (
    <WebPage fontFamily={WEB_FONTS.sansEn}>
      <WebImage
        src={d.image}
        placeholder="3:4"
        style={{ position: 'absolute', left: 83, top: 90, width: 628, height: 943 }}
      />
      <WebFolio folio={d.folio} totalPages={totalPages} fallback="06" />
    </WebPage>
  );
}
