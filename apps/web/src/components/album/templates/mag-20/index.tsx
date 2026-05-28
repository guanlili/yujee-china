import { COLORS, WEB_FONTS } from '../constants';
import { WebFolio, WebPage, brToReact } from '../web-utils';
import type { TemplateRenderProps } from '../types';

export function WebMag20({ data, totalPages }: TemplateRenderProps) {
  const d = data as {
    boxText?: string;
    title?: string;
    plate?: string;
    folio?: string;
  };
  return (
    <WebPage fontFamily={WEB_FONTS.sansEn}>
      <div
        style={{
          position: 'absolute',
          top: 220,
          left: 120,
          width: 260,
          border: `1px solid ${COLORS.ruleLight}`,
          padding: '16px 18px',
          lineHeight: 1.7,
          color: COLORS.ink2,
          letterSpacing: '0.02em',
          textAlign: 'left',
          fontSize: 16,
        }}
      >
        {d.boxText || ''}
      </div>
      <h1
        style={{
          position: 'absolute',
          top: 620,
          left: 120,
          margin: 0,
          fontFamily: WEB_FONTS.serifEn,
          fontWeight: 400,
          fontSize: 38,
          letterSpacing: '0.32em',
          lineHeight: 1.4,
        }}
      >
        {brToReact(d.title || 'MASASHI WAKUI\nAT NIGHT')}
      </h1>
      <div
        style={{
          position: 'absolute',
          top: 770,
          left: 120,
          width: 60,
          height: 1,
          background: COLORS.ink,
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: 790,
          left: 120,
          letterSpacing: '0.32em',
          color: COLORS.ink3,
          textTransform: 'uppercase',
          fontSize: 16,
        }}
      >
        {d.plate || ''}
      </div>
      <WebFolio folio={d.folio} totalPages={totalPages} fallback="20" />
    </WebPage>
  );
}
