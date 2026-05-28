import { COLORS, WEB_FONTS } from '../constants';
import { WebFolio, WebImage, WebPage } from '../web-utils';
import type { TemplateRenderProps } from '../types';

export function WebMag19({ data, totalPages }: TemplateRenderProps) {
  const d = data as {
    image?: string;
    intro?: string;
    captionLeft?: string;
    captionRight?: string;
    quote?: string;
    folio?: string;
  };
  return (
    <WebPage fontFamily={WEB_FONTS.sansEn}>
      <p
        style={{
          position: 'absolute',
          top: 230,
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
        style={{ position: 'absolute', top: 340, left: 70, right: 70, height: 460 }}
      />
      <p
        style={{
          position: 'absolute',
          top: 815,
          left: 70,
          width: 280,
          margin: 0,
          lineHeight: 1.7,
          color: COLORS.ink2,
          letterSpacing: '0.02em',
          textAlign: 'left',
          fontSize: 16,
        }}
      >
        {d.captionLeft || ''}
      </p>
      <p
        style={{
          position: 'absolute',
          top: 815,
          right: 70,
          width: 280,
          margin: 0,
          lineHeight: 1.7,
          color: COLORS.ink2,
          letterSpacing: '0.02em',
          textAlign: 'right',
          fontSize: 16,
        }}
      >
        {d.captionRight || ''}
      </p>
      <div
        style={{
          position: 'absolute',
          top: 340,
          right: 90,
          fontSize: 10,
          letterSpacing: '0.32em',
          color: COLORS.ink3,
          textTransform: 'uppercase',
          writingMode: 'vertical-rl',
        }}
      >
        Frame {d.folio || '19'} / 30
      </div>
      <p
        style={{
          position: 'absolute',
          bottom: 95,
          left: 70,
          right: 70,
          margin: 0,
          textAlign: 'center',
          fontFamily: WEB_FONTS.serifEn,
          fontStyle: 'italic',
          color: COLORS.ink,
          letterSpacing: '0.02em',
          fontSize: 16,
        }}
      >
        {d.quote || ''}
      </p>
      <WebFolio folio={d.folio} totalPages={totalPages} fallback="19" />
    </WebPage>
  );
}
