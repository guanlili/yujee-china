import { COLORS, WEB_FONTS } from '../constants';
import { WebFolio, WebImage, WebPage } from '../web-utils';
import type { TemplateRenderProps } from '../types';
import { resolveThemeCarrier } from '../theme-carrier';

export function WebMag18({ data, totalPages, imagePos }: TemplateRenderProps) {
  const d = data as {
    image1?: string;
    image2?: string;
    explain1?: string;
    explain2?: string;
    folio?: string;
  };
  const explain1Theme = resolveThemeCarrier(data, 'explain1');
  const explain2Theme = resolveThemeCarrier(data, 'explain2');
  const folioTheme = resolveThemeCarrier(data, 'folio');
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
      <div style={{ position: 'absolute', top: 778, left: 70, width: 320 }}>
        <p
          style={{
            margin: '0 0 7px',
            fontFamily: WEB_FONTS.montserrat,
            fontSize: 8,
            letterSpacing: '0.3em',
            color: COLORS.ink3,
          }}
        >
          PLATE I
        </p>
        <p
          style={{
            margin: 0,
            fontFamily: WEB_FONTS.montserrat,
            lineHeight: 1.75,
            color: explain1Theme.accentColor ?? COLORS.ink2,
            letterSpacing: '0.02em',
            textAlign: 'justify',
            fontSize: 15,
          }}
        >
          {d.explain1 || ''}
        </p>
      </div>
      <div style={{ position: 'absolute', top: 778, right: 70, width: 320 }}>
        <p
          style={{
            margin: '0 0 7px',
            fontFamily: WEB_FONTS.montserrat,
            fontSize: 8,
            letterSpacing: '0.3em',
            color: COLORS.ink3,
          }}
        >
          PLATE II
        </p>
        <p
          style={{
            margin: 0,
            fontFamily: WEB_FONTS.montserrat,
            lineHeight: 1.75,
            color: explain2Theme.accentColor ?? COLORS.ink2,
            letterSpacing: '0.02em',
            textAlign: 'justify',
            fontSize: 15,
          }}
        >
          {d.explain2 || ''}
        </p>
      </div>
      <WebFolio folio={d.folio} totalPages={totalPages} accentColor={folioTheme.accentColor} fallback="18" />
    </WebPage>
  );
}
