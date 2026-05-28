import { COLORS, WEB_FONTS } from '../constants';
import { WebFolio, WebImage, WebPage, brToReact } from '../web-utils';
import type { TemplateRenderProps } from '../types';

export function WebMag05({ data, totalPages }: TemplateRenderProps) {
  const d = data as {
    title?: string;
    topRight?: string;
    caption?: string;
    folio?: string;
    image?: string;
  };
  return (
    <WebPage fontFamily={WEB_FONTS.sansEn}>
      <h1
        style={{
          position: 'absolute',
          top: 110,
          left: 50,
          right: 280,
          margin: 0,
          fontFamily: WEB_FONTS.serifEn,
          fontSize: 44,
          letterSpacing: '0.04em',
          lineHeight: 1.15,
          fontWeight: 400,
        }}
      >
        {brToReact(d.title || "LET'S GO RIDE\nA BIKE")}
      </h1>
      <div
        style={{
          position: 'absolute',
          top: 60,
          right: 50,
          fontSize: 14,
          letterSpacing: '0.32em',
          color: COLORS.ink2,
          textTransform: 'uppercase',
        }}
      >
        {d.topRight || 'Journey · 05'}
      </div>
      <div style={{ position: 'absolute', top: 290, left: 50, width: 320 }}>
        <div
          style={{
            fontFamily: WEB_FONTS.serifEn,
            fontStyle: 'italic',
            fontSize: 20,
            color: COLORS.ink3,
            marginBottom: 10,
          }}
        >
          i.
        </div>
        <p
          style={{
            margin: 0,
            lineHeight: 1.75,
            color: COLORS.ink2,
            textAlign: 'justify',
            letterSpacing: '0.02em',
            fontSize: 16,
          }}
        >
          {d.caption || ''}
        </p>
      </div>
      <WebImage
        src={d.image}
        placeholder="3:2"
        style={{ position: 'absolute', top: 560, left: 50, right: 50, height: 460 }}
      />
      <WebFolio folio={d.folio} totalPages={totalPages} fallback="05" />
    </WebPage>
  );
}
