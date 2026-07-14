import { COLORS, WEB_FONTS } from '../constants';
import {WebImage, WebPage} from '../web-utils';
import type { TemplateRenderProps } from '../types';
import { resolveThemeCarrier } from '../theme-carrier';
import { contractRole } from '../contract-role';

export function WebMag19({ data, totalPages, imagePos }: TemplateRenderProps) {
  const d = data as {
    image?: string;
    title?: string;
    explain?: string;
    explain2?: string;
  };
  const introTheme = resolveThemeCarrier(data, 'title', contractRole('mag-19', 'title'));
  const explain1Theme = resolveThemeCarrier(data, 'explain', contractRole('mag-19', 'explain'));
  const explain2Theme = resolveThemeCarrier(data, 'explain2', contractRole('mag-19', 'explain2'));
  return (
    <WebPage fontFamily={WEB_FONTS.sansEn}>
      <p
        style={{
          position: 'absolute',
          top: 70,
          left: 60,
          width: 674,
          height: 90,
          margin: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          lineHeight: 1.05,
          color: introTheme.accentColor ?? COLORS.ink,
          letterSpacing: '0.01em',
          fontSize: 72,
          fontStyle: 'italic',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          fontFamily: introTheme.webFontFamily,
        }}
      >
        {introTheme.text ?? d.title ?? ''}
      </p>
      <WebImage
        src={d.image}
        placeholder="1:1"
        style={{ position: 'absolute', top: 170, left: 60, width: 674, height: 674 }}
        position={imagePos?.['image']}
        slotId="image"
      />
      <p
        style={{
          position: 'absolute',
          top: 868,
          left: 60,
          width: 300,
          margin: 0,
          lineHeight: 1.7,
          color: explain1Theme.accentColor ?? COLORS.ink2,
          letterSpacing: '0.02em',
          textAlign: 'left',
          fontSize: 18,
          fontFamily: explain1Theme.webFontFamily,
        }}
      >
        {d.explain || ''}
      </p>
      <p
        style={{
          position: 'absolute',
          top: 868,
          right: 60,
          width: 300,
          margin: 0,
          lineHeight: 1.7,
          color: explain2Theme.accentColor ?? COLORS.ink2,
          letterSpacing: '0.02em',
          textAlign: 'right',
          fontSize: 18,
          fontFamily: explain2Theme.webFontFamily,
        }}
      >
        {d.explain2 || ''}
      </p>
      </WebPage>
  );
}
