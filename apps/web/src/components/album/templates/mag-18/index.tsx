import { COLORS, WEB_FONTS } from '../constants';
import { WebFolio, WebImage, WebPage } from '../web-utils';
import type { TemplateRenderProps } from '../types';

export function WebMag18({ data, totalPages }: TemplateRenderProps) {
  const d = data as {
    imageLeft?: string;
    imageRight?: string;
    numLeft?: string;
    numRight?: string;
    captionLeft?: string;
    captionRight?: string;
    subtitle?: string;
    folio?: string;
  };
  return (
    <WebPage fontFamily={WEB_FONTS.sansEn}>
      <div
        style={{
          position: 'absolute',
          top: 110,
          left: 110,
          fontFamily: WEB_FONTS.serifEn,
          fontSize: 26,
          letterSpacing: '0.02em',
          color: COLORS.ink,
        }}
      >
        {d.numLeft || '19'}
      </div>
      <div
        style={{
          position: 'absolute',
          top: 110,
          left: 'calc(50% + 30px)',
          fontFamily: WEB_FONTS.serifEn,
          fontSize: 26,
          letterSpacing: '0.02em',
          color: COLORS.ink,
        }}
      >
        {d.numRight || '20'}
      </div>
      <WebImage
        src={d.imageLeft}
        placeholder="3:4"
        style={{ position: 'absolute', top: 170, left: 70, width: 320, height: 380 }}
      />
      <WebImage
        src={d.imageRight}
        placeholder="3:4"
        style={{ position: 'absolute', top: 170, right: 70, width: 320, height: 380 }}
      />
      <div
        style={{
          position: 'absolute',
          top: 580,
          left: 70,
          right: 70,
          height: 1,
          background: COLORS.ruleLight,
        }}
      />
      <p
        style={{
          position: 'absolute',
          top: 605,
          left: 70,
          width: 320,
          margin: 0,
          lineHeight: 1.75,
          color: COLORS.ink2,
          letterSpacing: '0.02em',
          textAlign: 'justify',
          fontSize: 16,
        }}
      >
        {d.captionLeft || ''}
      </p>
      <p
        style={{
          position: 'absolute',
          top: 605,
          right: 70,
          width: 320,
          margin: 0,
          lineHeight: 1.75,
          color: COLORS.ink2,
          letterSpacing: '0.02em',
          textAlign: 'justify',
          fontSize: 16,
        }}
      >
        {d.captionRight || ''}
      </p>
      <p
        style={{
          position: 'absolute',
          bottom: 130,
          left: 70,
          right: 70,
          margin: 0,
          textAlign: 'center',
          fontFamily: WEB_FONTS.serifEn,
          fontStyle: 'italic',
          fontSize: 13,
          color: COLORS.ink2,
          letterSpacing: '0.02em',
        }}
      >
        {d.subtitle || ''}
      </p>
      <WebFolio folio={d.folio} totalPages={totalPages} fallback="18" />
    </WebPage>
  );
}
