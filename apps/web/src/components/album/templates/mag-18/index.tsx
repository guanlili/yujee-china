import { COLORS, WEB_FONTS } from '../constants';
import { WebFolio, WebImage, WebPage } from '../web-utils';
import type { TemplateRenderProps } from '../types';

export function WebMag18({ data, totalPages, imagePos }: TemplateRenderProps) {
  const d = data as {
    imageLeft?: string;
    imageRight?: string;
    captionLeft?: string;
    captionRight?: string;
    folio?: string;
  };
  return (
    <WebPage fontFamily={WEB_FONTS.sansEn}>
      <WebImage
        src={d.imageLeft}
        placeholder="3:4"
        style={{ position: 'absolute', top: 170, left: 70, width: 320, height: 600 }}
        position={imagePos?.['imageLeft']}
      />
      <WebImage
        src={d.imageRight}
        placeholder="3:4"
        style={{ position: 'absolute', top: 170, right: 70, width: 320, height: 600 }}
        position={imagePos?.['imageRight']}
      />
      <p
        style={{
          position: 'absolute',
          top: 790,
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
          top: 790,
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
      <WebFolio folio={d.folio} totalPages={totalPages} fallback="18" />
    </WebPage>
  );
}
