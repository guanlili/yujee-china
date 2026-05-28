import { COLORS, WEB_FONTS } from '../constants';
import { WebFolio, WebImage, WebPage } from '../web-utils';
import type { TemplateRenderProps } from '../types';

export function WebMag06({ data, totalPages }: TemplateRenderProps) {
  const d = data as { category?: string; folio?: string; image?: string };
  return (
    <WebPage fontFamily={WEB_FONTS.sansEn}>
      <div
        style={{
          position: 'absolute',
          top: 60,
          left: 50,
          right: 50,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          fontSize: 14,
          letterSpacing: '0.32em',
          color: COLORS.ink2,
          textTransform: 'uppercase',
        }}
      >
        <span>{d.category || 'Landscape'}</span>
        <span />
      </div>
      <WebImage
        src={d.image}
        placeholder="3:4"
        style={{ position: 'absolute', top: 100, left: 50, right: 50, bottom: 130 }}
      />
      <WebFolio folio={d.folio} totalPages={totalPages} fallback="06" />
    </WebPage>
  );
}
