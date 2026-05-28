import { COLORS, WEB_FONTS } from '../constants';
import { WebFolio, WebImage, WebPage, brToReact } from '../web-utils';
import type { TemplateRenderProps } from '../types';

export function WebMag13({ data, totalPages }: TemplateRenderProps) {
  const d = data as {
    image?: string;
    title?: string;
    intro?: string;
    caption1?: string;
    caption2?: string;
    issue?: string;
    credit?: string;
    folio?: string;
  };
  return (
    <WebPage fontFamily={WEB_FONTS.sansEn}>
      <div
        style={{
          position: 'absolute',
          top: 110,
          left: 90,
          right: 90,
          fontFamily: WEB_FONTS.serifEn,
          fontWeight: 400,
          fontSize: 28,
          letterSpacing: '0.36em',
          textAlign: 'center',
          lineHeight: 1.35,
        }}
      >
        {brToReact(d.title || 'YUICHI TOKUDA\nPHOTOGRAPHY')}
      </div>
      <p
        style={{
          position: 'absolute',
          top: 240,
          left: 200,
          right: 200,
          margin: 0,
          textAlign: 'center',
          lineHeight: 1.7,
          color: COLORS.ink2,
          letterSpacing: '0.02em',
          fontSize: 16,
        }}
      >
        {d.intro || ''}
      </p>
      <WebImage
        src={d.image}
        placeholder="3:2"
        style={{ position: 'absolute', top: 340, left: 90, right: 90, height: 520 }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: 130,
          left: 90,
          right: 90,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          columnGap: 36,
          fontSize: 12,
          lineHeight: 1.75,
          color: COLORS.ink2,
          letterSpacing: '0.02em',
          textAlign: 'justify',
        }}
      >
        <p style={{ margin: 0, fontSize: 16 }}>{d.caption1 || ''}</p>
        <p style={{ margin: 0, fontSize: 16 }}>{d.caption2 || ''}</p>
      </div>
      <div
        style={{
          position: 'absolute',
          bottom: 75,
          left: 90,
          right: 90,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          fontSize: 10,
          letterSpacing: '0.3em',
          color: COLORS.ink3,
          textTransform: 'uppercase',
        }}
      >
        <span>{d.issue || ''}</span>
        <span>{d.credit || ''}</span>
      </div>
      <WebFolio folio={d.folio} totalPages={totalPages} fallback="13" />
    </WebPage>
  );
}
