import { COLORS, WEB_FONTS } from '../constants';
import { WebFolio, WebImage, WebPage } from '../web-utils';
import type { TemplateRenderProps } from '../types';

export function WebMag18({ data, totalPages, imagePos }: TemplateRenderProps) {
  const d = data as {
    image1?: string;
    image2?: string;
    explain1?: string;
    explain2?: string;
    folio?: string;
  };
  return (
    <WebPage fontFamily={WEB_FONTS.sansEn}>
      <WebImage
        src={d.image1}
        placeholder="3:4"
        style={{ position: 'absolute', top: 170, left: 70, width: 320, height: 600 }}
        position={imagePos?.['image1']}
        slotId="image1"
      />
      <WebImage
        src={d.image2}
        placeholder="3:4"
        style={{ position: 'absolute', top: 170, right: 70, width: 320, height: 600 }}
        position={imagePos?.['image2']}
        slotId="image2"
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
        {d.explain1 || ''}
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
        {d.explain2 || ''}
      </p>
      <WebFolio folio={d.folio} totalPages={totalPages} fallback="18" />
    </WebPage>
  );
}
