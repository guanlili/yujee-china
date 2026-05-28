import { COLORS, WEB_FONTS } from '../constants';
import { WebFolio, WebImage, WebPage } from '../web-utils';
import type { TemplateRenderProps } from '../types';

export function WebMag08({ data, totalPages }: TemplateRenderProps) {
  const d = data as {
    image?: string;
    dateNum?: string;
    caption1?: string;
    caption2?: string;
    title?: string;
    subtitle?: string;
    folio?: string;
  };
  const dn = (d.dateNum || '08/24').split('/');
  return (
    <WebPage fontFamily={WEB_FONTS.sansEn}>
      <div
        style={{
          position: 'absolute',
          top: 90,
          right: 70,
          fontFamily: WEB_FONTS.serifEn,
          fontStyle: 'italic',
          fontSize: 46,
          color: COLORS.ink,
          lineHeight: 1,
          letterSpacing: '0.02em',
        }}
      >
        {dn[0]}
        <span style={{ color: COLORS.ink2 }}>/</span>
        {dn[1]}
      </div>
      <WebImage
        src={d.image}
        placeholder="4:5"
        style={{ position: 'absolute', top: 100, left: 70, width: 360, height: 440 }}
      />
      <div
        style={{
          position: 'absolute',
          top: 670,
          left: 70,
          right: 70,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          columnGap: 28,
          fontSize: 14,
          lineHeight: 1.7,
          color: COLORS.ink2,
          letterSpacing: '0.02em',
          textAlign: 'justify',
        }}
      >
        <p style={{ margin: 0 }}>{d.caption1 || ''}</p>
        <p style={{ margin: 0 }}>{d.caption2 || ''}</p>
      </div>
      <h1
        style={{
          position: 'absolute',
          bottom: 130,
          left: 70,
          margin: 0,
          fontFamily: WEB_FONTS.serifEn,
          fontWeight: 400,
          fontSize: 60,
          letterSpacing: '0.08em',
          lineHeight: 1,
        }}
      >
        {d.title || 'EVENT'}
      </h1>
      <div
        style={{
          position: 'absolute',
          bottom: 95,
          left: 72,
          fontSize: 14,
          letterSpacing: '0.3em',
          color: COLORS.ink2,
          textTransform: 'uppercase',
        }}
      >
        {d.subtitle || ''}
      </div>
      <WebFolio folio={d.folio} totalPages={totalPages} fallback="08" />
    </WebPage>
  );
}
