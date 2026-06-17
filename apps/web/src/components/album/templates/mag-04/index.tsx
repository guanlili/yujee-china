import { COLORS, WEB_FONTS } from '../constants';
import { WebFolio, WebImage, WebPage } from '../web-utils';
import type { TemplateRenderProps } from '../types';

export function WebMag04({ data, totalPages, imagePos }: TemplateRenderProps) {
  const d = data as {
    image1?: string;
    image2?: string;
    image3?: string;
    caption1?: string;
    caption2?: string;
    dateNum?: string;
    folio?: string;
  };
  const dn = (d.dateNum || '04/24').split('/');
  return (
    <WebPage fontFamily={WEB_FONTS.sansEn}>
      <WebImage
        src={d.image1}
        placeholder="1:1"
        style={{ position: 'absolute', top: 60, left: 50, width: 380, height: 360 }}
        position={imagePos?.['image1']}
        slotId="image1"
      />
      <div
        style={{
          position: 'absolute',
          top: 180,
          left: 464,
          width: 280,
          height: 80,
          fontFamily: WEB_FONTS.serifEn,
          fontStyle: 'italic',
          fontSize: 64,
          lineHeight: 1,
          color: COLORS.ink,
          letterSpacing: '0.02em',
          textAlign: 'right',
        }}
      >
        {dn[0]}
        <span style={{ color: COLORS.ink3 }}>/{dn[1]}</span>
      </div>
      <div
        style={{
          position: 'absolute',
          top: 500,
          left: 60,
          width: 347,
          lineHeight: 1.75,
          color: COLORS.ink2,
          textAlign: 'justify',
          letterSpacing: '0.02em',
          fontSize: 20,
        }}
      >
        {d.caption1 || ''}
      </div>
      <WebImage
        src={d.image2}
        placeholder="1:1"
        style={{ position: 'absolute', top: 460, right: 50, width: 280, height: 280 }}
        position={imagePos?.['image2']}
        slotId="image2"
      />
      <div
        style={{
          position: 'absolute',
          top: 760,
          left: 60,
          width: 300,
          lineHeight: 1.75,
          color: COLORS.ink2,
          textAlign: 'justify',
          letterSpacing: '0.02em',
          fontSize: 20,
        }}
      >
        {d.caption2 || ''}
      </div>
      <WebImage
        src={d.image3}
        placeholder="1:1"
        style={{ position: 'absolute', top: 760, right: 50, width: 280, height: 280 }}
        position={imagePos?.['image3']}
        slotId="image3"
      />
      <WebFolio folio={d.folio} totalPages={totalPages} fallback="04" />
    </WebPage>
  );
}
