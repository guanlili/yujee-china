import { COLORS, WEB_FONTS } from '../constants';
import {WebImage, WebPage, brToReact} from '../web-utils';
import type { TemplateRenderProps } from '../types';
import { resolveThemeCarrier } from '../theme-carrier';
import { contractRole } from '../contract-role';

export function WebMag09({ data, totalPages, imagePos }: TemplateRenderProps) {
  const d = data as {
    image1?: string;
    image2?: string;
    body?: string;
    title?: string;
    explain?: string;
    explain2?: string;
    body2?: string;
  };
  const titleTheme = resolveThemeCarrier(data, 'title', contractRole('mag-09', 'title'));
  const bodyTheme = resolveThemeCarrier(data, 'body', contractRole('mag-09', 'body'));
  const explain1Theme = resolveThemeCarrier(data, 'explain', contractRole('mag-09', 'explain'));
  const explain2Theme = resolveThemeCarrier(data, 'explain2', contractRole('mag-09', 'explain2'));
  const explain3Theme = resolveThemeCarrier(data, 'body2', contractRole('mag-09', 'body2'));
  return (
    <WebPage fontFamily={WEB_FONTS.sansEn}>
      <WebImage
        src={d.image1}
        placeholder="4:3"
        style={{ position: 'absolute', left: 50, top: 90, width: 300, height: 300 }}
        position={imagePos?.['image1']}
        slotId="image1"
      />
      <div style={{ position: 'absolute', top: 130, right: 60, width: 230 }}>
        <p
          style={{ position: 'absolute', left: 504, top: 130, width: 230, height: 31, lineHeight: 1.7,
            color: bodyTheme.accentColor ?? COLORS.ink2,
            fontFamily: bodyTheme.webFontFamily,
            letterSpacing: '0.02em',
            textAlign: 'justify',
            fontSize: 18 }}
        >
          {d.body || ''}
        </p>
      </div>
      <h1
        style={{
          position: 'absolute',
          top: 396,
          left: 60,
          width: 300,
          height: 224,
          margin: 0,
          overflow: 'hidden',
          fontFamily: titleTheme.webFontFamily,
          fontWeight: 400,
          fontSize: 116,
          letterSpacing: '0.02em',
          lineHeight: 0.92,
          color: titleTheme.accentColor ?? COLORS.ink,
        }}
      >
        {brToReact(titleTheme.text ?? d.title ?? 'OSAKA\nJAPAN')}
      </h1>
      <WebImage
        src={d.image2}
        placeholder="11:10"
        style={{ position: 'absolute', left: 374, top: 400, width: 370, height: 600 }}
        position={imagePos?.['image2']}
        slotId="image2"
      />
      <div
        style={{
          position: 'absolute',
          top: 620,
          left: 60,
          width: 280,
          lineHeight: 1.75,
          color: COLORS.ink2,
          letterSpacing: '0.02em',
          textAlign: 'justify',
        }}
      >
        <p style={{ position: 'absolute', left: 60, top: 620, width: 280, height: 32, fontSize: 18, color: explain1Theme.accentColor ?? COLORS.ink2, fontFamily: explain1Theme.webFontFamily }}>{d.explain || ''}</p>
        <p style={{ position: 'absolute', left: 60, top: 664, width: 280, height: 32, fontSize: 18, color: explain2Theme.accentColor ?? COLORS.ink2, fontFamily: explain2Theme.webFontFamily }}>{d.explain2 || ''}</p>
        <p style={{ marginTop: 12, marginBottom: 0, fontSize: 13, lineHeight: 1.6, color: explain3Theme.accentColor ?? COLORS.ink2, fontFamily: explain3Theme.webFontFamily }}>{d.body2 || ''}</p>
      </div></WebPage>
  );
}
