import { COLORS, WEB_FONTS } from '../constants';
import { WebFolio, WebImage, WebPage } from '../web-utils';
import type { TemplateRenderProps } from '../types';
import { resolveThemeCarrier } from '../theme-carrier';

export function WebMag19({ data, totalPages, imagePos }: TemplateRenderProps) {
  const d = data as {
    image?: string;
    title?: string;
    explain1?: string;
    explain2?: string;
    folio?: string;
  };
  const introTheme = resolveThemeCarrier(data, 'title');
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
          color: introTheme.accentColor ?? COLORS.ink,
          letterSpacing: '0.02em',
          fontSize: 45,
          whiteSpace: 'nowrap',
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
          color: COLORS.ink2,
          letterSpacing: '0.02em',
          textAlign: 'left',
          fontSize: 18,
        }}
      >
        {d.explain1 || ''}
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
        {d.explain2 || ''}
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
