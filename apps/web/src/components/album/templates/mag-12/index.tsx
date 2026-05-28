import { COLORS, WEB_FONTS } from '../constants';
import { WebFolio, WebImage, WebPage } from '../web-utils';
import type { TemplateRenderProps } from '../types';

export function WebMag12({ data, totalPages }: TemplateRenderProps) {
  const d = data as {
    imageTop?: string;
    imageBottom?: string;
    num1?: string;
    num2?: string;
    folio?: string;
  };
  return (
    <WebPage fontFamily={WEB_FONTS.sansEn}>
      <div
        style={{
          position: 'absolute',
          top: 360,
          left: 230,
          fontFamily: WEB_FONTS.serifEn,
          fontSize: 32,
          letterSpacing: '0.02em',
          color: COLORS.ink,
        }}
      >
        {d.num1 || '13'}
      </div>
      <div
        style={{
          position: 'absolute',
          top: 395,
          left: 268,
          width: 120,
          height: 1,
          background: COLORS.ink,
          transform: 'rotate(-32deg)',
          transformOrigin: 'left center',
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: 560,
          left: 330,
          fontFamily: WEB_FONTS.serifEn,
          fontSize: 32,
          letterSpacing: '0.02em',
          color: COLORS.ink,
        }}
      >
        {d.num2 || '14'}
      </div>
      <div
        style={{
          position: 'absolute',
          top: 595,
          left: 368,
          width: 120,
          height: 1,
          background: COLORS.ink,
          transform: 'rotate(-32deg)',
          transformOrigin: 'left center',
        }}
      />
      <WebImage
        src={d.imageTop}
        placeholder="1:1"
        style={{ position: 'absolute', top: 280, right: 70, width: 220, height: 220 }}
      />
      <WebImage
        src={d.imageBottom}
        placeholder="4:5"
        style={{ position: 'absolute', top: 520, right: 70, width: 220, height: 290 }}
      />
      <WebFolio folio={d.folio} totalPages={totalPages} fallback="12" />
    </WebPage>
  );
}
