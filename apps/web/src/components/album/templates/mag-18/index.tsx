import { COLORS, WEB_FONTS } from '../constants';
import {WebImage, WebPage} from '../web-utils';
import type { TemplateRenderProps } from '../types';
import { resolveThemeCarrier } from '../theme-carrier';
import { contractRole } from '../contract-role';

export function WebMag18({ data, totalPages, imagePos }: TemplateRenderProps) {
  const d = data as {
    image1?: string;
    image2?: string;
    explain?: string;
    explain2?: string;
  };
  const explainTheme = resolveThemeCarrier(data, 'explain', contractRole('mag-18', 'explain'));
  const explain2Theme = resolveThemeCarrier(data, 'explain2', contractRole('mag-18', 'explain2'));
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
            fontFamily: explainTheme.webFontFamily,
            lineHeight: 1.75,
            color: explainTheme.accentColor ?? COLORS.ink2,
            letterSpacing: '0.02em',
            textAlign: 'justify',
            fontSize: 15,
          }}
        >
          {d.explain || ''}
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
            fontFamily: explain2Theme.webFontFamily,
            lineHeight: 1.75,
            color: explain2Theme.accentColor ?? COLORS.ink2,
            letterSpacing: '0.02em',
            textAlign: 'justify',
            fontSize: 15,
          }}
        >
          {d.explain2 || ''}
        </p>
      </div></WebPage>
  );
}
