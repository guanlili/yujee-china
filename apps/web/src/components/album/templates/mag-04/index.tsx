import { COLORS, WEB_FONTS } from '../constants';
import { WebFolio, WebImage, WebPage } from '../web-utils';
import type { TemplateRenderProps } from '../types';

export function WebMag04({ data, totalPages }: TemplateRenderProps) {
  const d = data as {
    image1?: string;
    image2?: string;
    image3?: string;
    caption1?: string;
    caption2?: string;
    dateNum?: string;
    folio?: string;
  };
  const dn = (d.dateNum || '04/24').split('/');
  return (
    <WebPage fontFamily={WEB_FONTS.sansEn}>
      <WebImage
        src={d.image1}
        placeholder="4:3"
        style={{ position: 'absolute', top: 100, left: 50, width: 380, height: 300 }}
      />
      <div
        style={{
          position: 'absolute',
          top: 260,
          right: 50,
          fontFamily: WEB_FONTS.serifEn,
          fontStyle: 'italic',
          fontSize: 64,
          lineHeight: 1,
          color: COLORS.ink,
          letterSpacing: '0.02em',
        }}
      >
        {dn[0]}
        <span style={{ color: COLORS.ink3 }}>/{dn[1]}</span>
      </div>
      <div
        style={{
          position: 'absolute',
          top: 440,
          left: 50,
          width: 300,
          lineHeight: 1.75,
          color: COLORS.ink2,
          textAlign: 'justify',
          letterSpacing: '0.02em',
          fontSize: 16,
        }}
      >
        {d.caption1 || ''}
      </div>
      <WebImage
        src={d.image2}
        placeholder="4:5"
        style={{ position: 'absolute', top: 430, right: 50, width: 230, height: 280 }}
      />
      <div
        style={{
          position: 'absolute',
          top: 760,
          left: 50,
          width: 300,
          lineHeight: 1.75,
          color: COLORS.ink2,
          textAlign: 'justify',
          letterSpacing: '0.02em',
          fontSize: 16,
        }}
      >
        {d.caption2 || ''}
      </div>
      <WebImage
        src={d.image3}
        placeholder="1:1"
        style={{ position: 'absolute', top: 740, right: 50, width: 230, height: 230 }}
      />
      <WebFolio folio={d.folio} totalPages={totalPages} fallback="04" />
    </WebPage>
  );
}
