import { COLORS, WEB_FONTS } from '../constants';
import { WebImage, WebPage, brToReact } from '../web-utils';
import type { TemplateRenderProps } from '../types';
import { resolveThemeCarrier } from '../theme-carrier';
import { contractRole } from '../contract-role';

export function WebP01({ data, imagePos }: TemplateRenderProps) {
  const d = data as {
    image?: string;
    title?: string;
    body?: string;
    label?: string;
    label1Color?: string;
    label2?: string;
    label3?: string;
  };
  const titleTheme = resolveThemeCarrier(data, 'title', contractRole('p01', 'title'));
  const categoryTheme = resolveThemeCarrier(data, 'label', contractRole('p01', 'label'));
  const volTheme = resolveThemeCarrier(data, 'label2', contractRole('p01', 'label2'));
  const dateTheme = resolveThemeCarrier(data, 'label3', contractRole('p01', 'label3'));
  const bodyTheme = resolveThemeCarrier(data, 'body', contractRole('p01', 'body'));
  return (
    <WebPage dark fontFamily={WEB_FONTS.serifCn}>
      <WebImage
        src={d.image}
        placeholder="1:1"
        style={{ position: 'absolute', top: 0, bottom: 320, left: 0, width: 794, objectFit: 'cover' }}
        position={imagePos?.['image']}
        slotId="image"
      />
      <div
        style={{
          position: 'absolute',
          top: 36,
          left: 56,
          right: 56,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          fontFamily: WEB_FONTS.mono,
          letterSpacing: '0.3em',
          color: '#ffffff',
          fontSize: 14,
        }}
      >
        <span>
          VOL.{' '}
          <span
            style={{
              color: volTheme.accentColor,
              fontFamily: volTheme.webFontFamily,
            }}
          >
            {volTheme.text ?? d.label2 ?? '01'}
          </span>{' '}
          ·{' '}
          <span
            style={{
              color: dateTheme.accentColor,
              fontFamily: dateTheme.webFontFamily,
            }}
          >
            {dateTheme.text ?? d.label3 ?? '2026'}
          </span>
        </span>
        <span>MEMOIR</span>
      </div>
      <div
        style={{
          position: 'absolute',
          top: 70,
          right: 56,
          fontFamily: volTheme.webFontFamily,
          fontStyle: 'italic',
          fontSize: 100,
          lineHeight: 0.9,
          color: volTheme.accentColor ?? '#ffffff',
        }}
      >
        {volTheme.text ?? d.label2 ?? '01'}
      </div>
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 320,
          background: COLORS.ink,
          padding: '40px 56px 0',
        }}
      >
        <div
          style={{
            fontFamily: categoryTheme.webFontFamily,
            fontStyle: 'italic',
            letterSpacing: '0.04em',
            color: categoryTheme.accentColor ?? d.label1Color ?? COLORS.vermilionSoft,
            fontSize: 16,
          }}
        >
          {categoryTheme.text ?? d.label ?? 'nº 01 · Portrait'}
        </div>
        <h1
          style={{
            margin: '8px 0 0',
            fontFamily: titleTheme.webFontFamily,
            fontWeight: 500,
            letterSpacing: '0.04em',
            lineHeight: 1.15,
            color: titleTheme.accentColor ?? COLORS.paper,
            fontSize: 56,
          }}
        >
          {brToReact(titleTheme.text ?? d.title ?? 'Page Title')}
        </h1>
        <div style={{ marginTop: 22 }}>
          <p
            style={{
              margin: 0,
              fontFamily: bodyTheme.webFontFamily,
              lineHeight: 1.85,
              color: bodyTheme.accentColor ?? COLORS.paper78,
              textAlign: 'justify',
              fontSize: 18,
            }}
          >
            {d.body || ''}
          </p>
        </div>
      </div>
    </WebPage>
  );
}
