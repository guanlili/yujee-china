import { COLORS, WEB_FONTS } from '../constants';
import { WebImage, WebPage } from '../web-utils';
import type { TemplateRenderProps } from '../types';
import { resolveThemeCarrier } from '../theme-carrier';

export function WebMag01({ data, imagePos }: TemplateRenderProps) {
  const d = data as {
    title?: string;
    label?: string;
    explain1?: string;
    explain2?: string;
    folio?: string;
    image?: string;
  };
  const headingTheme = resolveThemeCarrier(data, 'title');
  const sideTextTheme = resolveThemeCarrier(data, 'label');
  return (
    <WebPage fontFamily={WEB_FONTS.sansEn}>
      <div
        style={{
          position: 'absolute',
          top: 140,
          left: 130,
          right: 130,
          display: 'flex',
          alignItems: 'center',
          gap: 16,
        }}
      >
        <div
          style={{
            letterSpacing: '0.04em',
            fontWeight: 700,
            fontSize: 72,
            lineHeight: 1,
            whiteSpace: 'nowrap',
            color: headingTheme.accentColor,
            fontFamily: WEB_FONTS.playfair,
          }}
        >
          {headingTheme.text ?? d.title ?? 'VENUES'}
        </div>
        <div style={{ flex: 1, height: 3, background: COLORS.ink }} />
        <div
          style={{
            width: 26,
            height: 26,
            borderRadius: '50%',
            border: `1px solid ${COLORS.ink}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: WEB_FONTS.mono,
            fontSize: 16,
          }}
        >
          N
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          top: 290,
          left: 56,
          writingMode: 'vertical-rl',
          letterSpacing: '0.36em',
          color: sideTextTheme.accentColor ?? COLORS.ink2,
          textTransform: 'uppercase',
          fontSize: 14,
          fontFamily: sideTextTheme.webFontFamily,
        }}
      >
        {sideTextTheme.text ?? d.label ?? ''}
      </div>
      <WebImage
        src={d.image}
        placeholder="3:2"
        style={{ position: 'absolute', top: 240, right: 0, width: 660, height: 460 }}
        position={imagePos?.['image']}
        slotId="image"
      />
      <div
        style={{
          position: 'absolute',
          left: 130,
          top: 720,
          lineHeight: 1.7,
          color: COLORS.ink2,
          letterSpacing: '0.02em',
          fontSize: 18,
          width: 360,
        }}
      >
        {d.explain1 || ''}
      </div>
      <div
        style={{
          position: 'absolute',
          left: 130,
          top: 840,
          lineHeight: 1.7,
          color: COLORS.ink2,
          textAlign: 'justify',
          letterSpacing: '0.02em',
          fontSize: 18,
          width: 360,
        }}
      >
        {d.explain2 || ''}
      </div>
    </WebPage>
  );
}
