import { COLORS, WEB_FONTS } from '../constants';
import { WebImage, WebPage } from '../web-utils';
import type { TemplateRenderProps } from '../types';

export function WebMag01({ data }: TemplateRenderProps) {
  const d = data as {
    heading?: string;
    sideText?: string;
    caption1?: string;
    caption2?: string;
    folio?: string;
    image?: string;
  };
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
        <div style={{ letterSpacing: '0.36em', fontWeight: 400, fontSize: 34 }}>
          {d.heading || 'VENUES'}
        </div>
        <div style={{ flex: 1, height: 1, background: COLORS.ink }} />
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
          color: COLORS.ink2,
          textTransform: 'uppercase',
          fontSize: 14,
        }}
      >
        {d.sideText || ''}
      </div>
      <WebImage
        src={d.image}
        placeholder="3:2"
        style={{ position: 'absolute', top: 240, right: 0, width: 660, height: 460 }}
      />
      <div
        style={{
          position: 'absolute',
          left: 130,
          top: 760,
          lineHeight: 1.7,
          color: COLORS.ink2,
          letterSpacing: '0.02em',
          fontSize: 18,
          width: 360,
        }}
      >
        {d.caption1 || ''}
      </div>
      <div
        style={{
          position: 'absolute',
          left: 130,
          top: 880,
          lineHeight: 1.7,
          color: COLORS.ink2,
          textAlign: 'justify',
          letterSpacing: '0.02em',
          fontSize: 18,
          width: 360,
        }}
      >
        {d.caption2 || ''}
      </div>
    </WebPage>
  );
}
