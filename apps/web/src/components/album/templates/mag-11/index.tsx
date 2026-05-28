import { COLORS, WEB_FONTS } from '../constants';
import { WebFolio, WebImage, WebPage, brToReact } from '../web-utils';
import type { TemplateRenderProps } from '../types';

export function WebMag11({ data, totalPages }: TemplateRenderProps) {
  const d = data as {
    image?: string;
    title?: string;
    plate?: string;
    caption2?: string;
    folio?: string;
  };
  return (
    <WebPage fontFamily={WEB_FONTS.sansEn}>
      <WebImage
        src={d.image}
        placeholder="4:5"
        style={{ position: 'absolute', top: 120, left: 50, right: 50, height: 640 }}
      />
      <h1
        style={{
          position: 'absolute',
          top: 800,
          left: 50,
          margin: 0,
          fontFamily: WEB_FONTS.serifEn,
          fontWeight: 400,
          fontSize: 50,
          letterSpacing: '0.06em',
          lineHeight: 1.1,
        }}
      >
        {brToReact(d.title || 'CHERRY\nBUCKET')}
      </h1>
      <div style={{ position: 'absolute', top: 980, left: 50, width: 260 }}>
        <div
          style={{
            fontSize: 13,
            letterSpacing: '0.3em',
            color: COLORS.ink,
            textTransform: 'uppercase',
          }}
        >
          {d.plate || ''}
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          top: 800,
          right: 50,
          width: 200,
          lineHeight: 1.75,
          color: COLORS.ink2,
          letterSpacing: '0.02em',
          textAlign: 'justify',
        }}
      >
        <p style={{ margin: 0, fontSize: 16 }}>{d.caption2 || ''}</p>
      </div>
      <WebFolio folio={d.folio} totalPages={totalPages} fallback="11" />
    </WebPage>
  );
}
