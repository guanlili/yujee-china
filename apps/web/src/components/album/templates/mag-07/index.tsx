import { COLORS, WEB_FONTS } from '../constants';
import { WebFolio, WebImage, WebPage, brToReact } from '../web-utils';
import type { TemplateRenderProps } from '../types';

export function WebMag07({ data, totalPages }: TemplateRenderProps) {
  const d = data as {
    imageTop?: string;
    imageMain?: string;
    caption1?: string;
    caption2?: string;
    caption3?: string;
    title?: string;
    folio?: string;
  };
  const captionStyle = {
    margin: 0,
    lineHeight: 1.7,
    color: COLORS.ink2,
    textAlign: 'justify' as const,
    letterSpacing: '0.02em',
    fontSize: 16,
  };
  const indexStyle = {
    fontSize: 14,
    letterSpacing: '0.28em',
    color: COLORS.ink2,
    textTransform: 'uppercase' as const,
    marginBottom: 8,
  };
  return (
    <WebPage fontFamily={WEB_FONTS.sansEn}>
      <div style={{ position: 'absolute', top: 90, left: 50, width: 240 }}>
        <div style={indexStyle}>i.</div>
        <p style={captionStyle}>{d.caption1 || ''}</p>
      </div>
      <WebImage
        src={d.imageTop}
        placeholder="5:3"
        style={{ position: 'absolute', top: 90, right: 50, width: 380, height: 230 }}
      />
      <div style={{ position: 'absolute', top: 360, left: 50, width: 240 }}>
        <div style={indexStyle}>ii.</div>
        <p style={captionStyle}>{d.caption2 || ''}</p>
      </div>
      <div style={{ position: 'absolute', top: 540, left: 50, width: 240 }}>
        <div style={indexStyle}>iii.</div>
        <p style={captionStyle}>{d.caption3 || ''}</p>
      </div>
      <WebImage
        src={d.imageMain}
        placeholder="4:5"
        style={{ position: 'absolute', top: 360, right: 50, width: 380, height: 480 }}
      />
      <h1
        style={{
          position: 'absolute',
          bottom: 70,
          left: 50,
          margin: 0,
          fontFamily: WEB_FONTS.serifEn,
          fontSize: 48,
          letterSpacing: '0.06em',
          lineHeight: 1.15,
          fontWeight: 400,
        }}
      >
        {brToReact(d.title || 'FUSHI\nINARI')}
      </h1>
      <WebFolio folio={d.folio} totalPages={totalPages} fallback="07" />
    </WebPage>
  );
}
