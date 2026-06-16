import { COLORS, WEB_FONTS } from '../constants';
import { WebFolio, WebImage, WebPage } from '../web-utils';
import type { TemplateRenderProps } from '../types';

export function WebMag19({ data, totalPages, imagePos }: TemplateRenderProps) {
  const d = data as {
    image?: string;
    intro?: string;
    captionLeft?: string;
    captionRight?: string;
    folio?: string;
  };
  return (
    <WebPage fontFamily={WEB_FONTS.sansEn}>
      <p
        style={{
          position: 'absolute',
          top: 100,
          left: 70,
          right: 70,
          margin: 0,
          textAlign: 'center',
          lineHeight: 1.4,
          color: COLORS.ink,
          letterSpacing: '0.02em',
          fontSize: 45,
          whiteSpace: 'nowrap',
        }}
      >
        {d.intro || ''}
      </p>
      <WebImage
        src={d.image}
        placeholder="1:1"
        style={{ position: 'absolute', top: 170, left: 60, width: 674, height: 674 }}
        position={imagePos?.['image']}
      />
      <p
        style={{
          position: 'absolute',
          top: 868,
          left: 60,
          width: 300,
          margin: 0,
          lineHeight: 1.7,
          color: COLORS.ink2,
          letterSpacing: '0.02em',
          textAlign: 'left',
          fontSize: 18,
        }}
      >
        {d.captionLeft || ''}
      </p>
      <p
        style={{
          position: 'absolute',
          top: 868,
          right: 60,
          width: 300,
          margin: 0,
          lineHeight: 1.7,
          color: COLORS.ink2,
          letterSpacing: '0.02em',
          textAlign: 'right',
          fontSize: 18,
        }}
      >
        {d.captionRight || ''}
      </p>
      <div
        style={{
          position: 'absolute',
          top: 420,
          right: 80,
          fontSize: 10,
          letterSpacing: '0.32em',
          color: COLORS.ink3,
          textTransform: 'uppercase',
          writingMode: 'vertical-rl',
        }}
      >
        Frame {d.folio || '19'} / 30
      </div>
      <WebFolio folio={d.folio} totalPages={totalPages} fallback="19" />
    </WebPage>
  );
}
