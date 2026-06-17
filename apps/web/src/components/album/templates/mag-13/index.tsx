import { COLORS, WEB_FONTS } from '../constants';
import { WebImage, WebPage, brToReact } from '../web-utils';
import type { TemplateRenderProps } from '../types';

export function WebMag13({ data, imagePos }: TemplateRenderProps) {
  const d = data as {
    image?: string;
    title?: string;
    caption?: string;
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
      <WebImage
        src={d.image}
        placeholder="3:2"
        style={{ position: 'absolute', top: 300, left: 90, right: 90, height: 520 }}
        position={imagePos?.['image']}
        slotId="image"
      />
      <p
        style={{
          position: 'absolute',
          top: 855,
          left: 130,
          right: 130,
          margin: 0,
          textAlign: 'center',
          lineHeight: 1.75,
          color: COLORS.ink2,
          letterSpacing: '0.02em',
          fontSize: 15,
        }}
      >
        {d.caption || ''}
      </p>
    </WebPage>
  );
}
