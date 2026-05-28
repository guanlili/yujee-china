import { COLORS, WEB_FONTS } from '../constants';
import { WebFolio, WebImage, WebPage, brToReact } from '../web-utils';
import type { TemplateRenderProps } from '../types';

export function WebMag16({ data, totalPages }: TemplateRenderProps) {
  const d = data as {
    imageTiny?: string;
    imagePerson?: string;
    imageHarbor?: string;
    caption1?: string;
    caption2?: string;
    caption3?: string;
    quote?: string;
    folio?: string;
  };
  return (
    <WebPage fontFamily={WEB_FONTS.sansEn}>
      <div style={{ position: 'absolute', top: 110, left: 70, width: 340 }}>
        <p
          style={{
            margin: 0,
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
      <WebImage
        src={d.imageTiny}
        placeholder="2:3"
        style={{ position: 'absolute', top: 110, right: 70, width: 220, height: 180 }}
      />
      <div style={{ position: 'absolute', top: 330, left: 70, width: 340 }}>
        <p
          style={{
            margin: 0,
            lineHeight: 1.7,
            color: COLORS.ink2,
            letterSpacing: '0.02em',
            textAlign: 'justify',
            fontSize: 16,
          }}
        >
          {d.caption2 || ''}
        </p>
      </div>
      <WebImage
        src={d.imagePerson}
        placeholder="4:3"
        style={{ position: 'absolute', top: 470, left: 70, width: 290, height: 220 }}
      />
      <WebImage
        src={d.imageHarbor}
        placeholder="4:3"
        style={{ position: 'absolute', top: 470, right: 70, width: 290, height: 220 }}
      />
      <p
        style={{
          position: 'absolute',
          top: 730,
          right: 70,
          width: 290,
          margin: 0,
          fontFamily: WEB_FONTS.serifEn,
          fontStyle: 'italic',
          lineHeight: 1.6,
          color: COLORS.ink,
          letterSpacing: '0.02em',
          textAlign: 'right',
          fontSize: 16,
        }}
      >
        {brToReact(d.quote || '')}
      </p>
      <p
        style={{
          position: 'absolute',
          top: 730,
          left: 70,
          width: 290,
          margin: 0,
          lineHeight: 1.75,
          color: COLORS.ink2,
          letterSpacing: '0.02em',
          textAlign: 'justify',
          fontSize: 16,
        }}
      >
        {d.caption3 || ''}
      </p>
      <WebFolio folio={d.folio} totalPages={totalPages} fallback="16" />
    </WebPage>
  );
}
