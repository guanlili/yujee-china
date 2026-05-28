import { COLORS, WEB_FONTS } from '../constants';
import { WebFolio, WebImage, WebPage, brToReact } from '../web-utils';
import type { TemplateRenderProps } from '../types';

export function WebMag09({ data, totalPages }: TemplateRenderProps) {
  const d = data as {
    imageTop?: string;
    imageMain?: string;
    quote?: string;
    caption1?: string;
    title?: string;
    caption2?: string;
    caption3?: string;
    folio?: string;
  };
  return (
    <WebPage fontFamily={WEB_FONTS.sansEn}>
      <WebImage
        src={d.imageTop}
        placeholder="4:3"
        style={{ position: 'absolute', top: 110, left: 60, width: 280, height: 210 }}
      />
      <div style={{ position: 'absolute', top: 130, right: 60, width: 230 }}>
        <p
          style={{
            margin: 0,
            fontFamily: WEB_FONTS.serifEn,
            fontStyle: 'italic',
            fontSize: 16,
            lineHeight: 1.55,
            color: COLORS.ink,
          }}
        >
          {d.quote || ''}
        </p>
        <p
          style={{
            marginTop: 14,
            marginBottom: 0,
            lineHeight: 1.7,
            color: COLORS.ink2,
            letterSpacing: '0.02em',
            textAlign: 'justify',
            fontSize: 16,
          }}
        >
          {d.caption1 || ''}
        </p>
      </div>
      <h1
        style={{
          position: 'absolute',
          top: 380,
          left: 60,
          margin: 0,
          fontFamily: WEB_FONTS.serifEn,
          fontWeight: 400,
          fontSize: 64,
          letterSpacing: '0.06em',
          lineHeight: 1.05,
        }}
      >
        {brToReact(d.title || 'OSAKA\nJAPAN')}
      </h1>
      <WebImage
        src={d.imageMain}
        placeholder="11:10"
        style={{ position: 'absolute', top: 590, right: 60, width: 360, height: 330 }}
      />
      <div
        style={{
          position: 'absolute',
          top: 620,
          left: 60,
          width: 280,
          lineHeight: 1.75,
          color: COLORS.ink2,
          letterSpacing: '0.02em',
          textAlign: 'justify',
        }}
      >
        <p style={{ margin: 0, fontSize: 16 }}>{d.caption2 || ''}</p>
        <p style={{ marginTop: 12, marginBottom: 0, fontSize: 16 }}>{d.caption3 || ''}</p>
      </div>
      <WebFolio folio={d.folio} totalPages={totalPages} fallback="09" />
    </WebPage>
  );
}
