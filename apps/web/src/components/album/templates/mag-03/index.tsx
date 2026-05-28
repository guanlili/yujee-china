import { COLORS, WEB_FONTS } from '../constants';
import { WebFolio, WebImage, WebPage } from '../web-utils';
import type { TemplateRenderProps } from '../types';

export function WebMag03({ data, totalPages }: TemplateRenderProps) {
  const d = data as {
    category?: string;
    location?: string;
    caption?: string;
    folio?: string;
    image?: string;
  };
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
          fontSize: 12,
          letterSpacing: '0.32em',
          color: COLORS.ink2,
          textTransform: 'uppercase',
        }}
      >
        <span
          style={{
            letterSpacing: 3,
            fontWeight: 500,
            fontFamily: WEB_FONTS.sansCn,
            fontSize: 16,
          }}
        >
          {d.category || 'Portrait'}
        </span>
      </div>
      <WebImage
        src={d.image}
        placeholder="3:4"
        style={{ position: 'absolute', top: 100, left: 50, right: 50, bottom: 130 }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: 80,
          left: 50,
          right: 50,
          display: 'flex',
          justifyContent: 'flex-start',
          alignItems: 'flex-end',
          gap: 30,
        }}
      >
        <div style={{ maxWidth: 360 }}>
          <div
            style={{
              letterSpacing: '0.3em',
              color: COLORS.ink,
              textTransform: 'uppercase',
              marginBottom: 8,
              fontSize: 16,
            }}
          >
            {d.location || ''}
          </div>
          <div
            style={{
              lineHeight: 1.7,
              color: COLORS.ink2,
              letterSpacing: '0.02em',
              fontSize: 16,
              fontFamily: WEB_FONTS.sansCn,
            }}
          >
            {d.caption || ''}
          </div>
        </div>
      </div>
      <WebFolio folio={d.folio} totalPages={totalPages} fallback="03" />
    </WebPage>
  );
}
