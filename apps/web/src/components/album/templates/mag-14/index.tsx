import { COLORS, WEB_FONTS } from '../constants';
import { WebFolio, WebPage } from '../web-utils';
import type { TemplateRenderProps } from '../types';

export function WebMag14({ data, totalPages }: TemplateRenderProps) {
  const d = data as {
    bigNum?: string;
    bigNumTotal?: string;
    body?: string;
    subtitleQuote?: string;
    bracketQuote?: string;
    footnote?: string;
    folio?: string;
  };
  return (
    <WebPage fontFamily={WEB_FONTS.sansEn}>
      <div
        style={{
          position: 'absolute',
          top: 230,
          left: 110,
          fontFamily: WEB_FONTS.serifEn,
          fontStyle: 'italic',
          fontSize: 96,
          lineHeight: 1,
          color: COLORS.ink,
          letterSpacing: '0.02em',
        }}
      >
        {d.bigNum || '11'}
        <span style={{ color: COLORS.ink3 }}>/</span>
        <span style={{ color: COLORS.ink3 }}>{d.bigNumTotal || '33'}</span>
      </div>
      <p
        style={{
          position: 'absolute',
          top: 410,
          left: 110,
          width: 260,
          margin: 0,
          lineHeight: 1.85,
          color: COLORS.ink2,
          letterSpacing: '0.02em',
          textAlign: 'justify',
          fontSize: 16,
        }}
      >
        {d.body || ''}
      </p>
      <div
        style={{
          position: 'absolute',
          top: 600,
          left: 110,
          right: 110,
          fontFamily: WEB_FONTS.serifEn,
          fontStyle: 'italic',
          color: COLORS.ink,
          letterSpacing: '0.02em',
          fontSize: 16,
        }}
      >
        {d.subtitleQuote || ''}
      </div>
      <div
        style={{
          position: 'absolute',
          top: 680,
          left: 110,
          width: 360,
          lineHeight: 1.85,
          color: COLORS.ink2,
          letterSpacing: '0.02em',
          textAlign: 'justify',
          fontSize: 16,
        }}
      >
        [ {d.bracketQuote || ''} ]
      </div>
      <div
        style={{
          position: 'absolute',
          bottom: 75,
          left: 110,
          width: 380,
          fontSize: 10,
          lineHeight: 1.7,
          color: COLORS.ink3,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
        }}
      >
        {d.footnote || ''}
      </div>
      <WebFolio folio={d.folio} totalPages={totalPages} fallback="14" />
    </WebPage>
  );
}
