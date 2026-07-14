import { COLORS, WEB_FONTS } from '../constants';
import {WebImage, WebPage, brToReact} from '../web-utils';
import type { TemplateRenderProps } from '../types';
import { resolveThemeCarrier } from '../theme-carrier';
import { contractRole } from '../contract-role';

export function WebMag11({ data, totalPages, imagePos }: TemplateRenderProps) {
  const d = data as {
    image?: string;
    title?: string;
    explain?: string;
    body?: string;
  };
  const titleTheme = resolveThemeCarrier(data, 'title', contractRole('mag-11', 'title'));
  const labelTheme = resolveThemeCarrier(data, 'explain', contractRole('mag-11', 'explain'));
  const explainTheme = resolveThemeCarrier(data, 'body', contractRole('mag-11', 'body'));
  return (
    <WebPage fontFamily={WEB_FONTS.sansEn}>
      <WebImage
        src={d.image}
        placeholder="4:5"
        style={{ position: 'absolute', top: 120, left: 25, right: 25, height: 640 }}
        position={imagePos?.['image']}
        slotId="image"
      />
      <h1
        style={{
          position: 'absolute',
          top: 792,
          left: 50,
          margin: 0,
          width: 360,
          fontFamily: titleTheme.webFontFamily,
          fontWeight: 700,
          fontSize: 76,
          letterSpacing: '0.01em',
          lineHeight: 1.02,
          color: titleTheme.accentColor ?? COLORS.ink,
        }}
      >
        {brToReact(titleTheme.text ?? d.title ?? 'CHERRY\nBUCKET')}
      </h1>
      <div style={{ position: 'absolute', top: 992, left: 50, width: 280 }}>
        <div
          style={{
            fontSize: 13,
            letterSpacing: '0.3em',
            color: labelTheme.accentColor ?? COLORS.ink,
            textTransform: 'uppercase',
            fontFamily: labelTheme.webFontFamily,
            fontWeight: 600,
          }}
        >
          {labelTheme.text ?? d.explain ?? ''}
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          top: 800,
          right: 50,
          width: 200,
          lineHeight: 1.75,
          color: COLORS.ink2,
          letterSpacing: '0.02em',
          textAlign: 'justify',
        }}
      >
        <p style={{ margin: 0, fontSize: 18, color: explainTheme.accentColor ?? COLORS.ink2, fontFamily: explainTheme.webFontFamily }}>{d.explain || ''}</p>
      </div></WebPage>
  );
}
