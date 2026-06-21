import { COLORS, WEB_FONTS } from '../constants';
import { WebFolio, WebImage, WebPage, brToReact } from '../web-utils';
import type { TemplateRenderProps } from '../types';
import { resolveThemeCarrier } from '../theme-carrier';

export function WebMag09({ data, totalPages, imagePos }: TemplateRenderProps) {
  const d = data as {
    image1?: string;
    image2?: string;
    body?: string;
    title?: string;
    explain1?: string;
    explain2?: string;
    explain3?: string;
    folio?: string;
  };
  const titleTheme = resolveThemeCarrier(data, 'title');
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
            color: COLORS.ink2,
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
          top: 400,
          left: 60,
          margin: 0,
          fontFamily: titleTheme.webFontFamily ?? WEB_FONTS.serifEn,
          fontWeight: 400,
          fontSize: 64,
          letterSpacing: '0.06em',
          lineHeight: 1.05,
          color: titleTheme.accentColor,
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
        <p style={{ position: 'absolute', left: 60, top: 620, width: 280, height: 32, fontSize: 18 }}>{d.explain1 || ''}</p>
        <p style={{ position: 'absolute', left: 60, top: 664, width: 280, height: 32, fontSize: 18 }}>{d.explain2 || ''}</p>
        <p style={{ marginTop: 12, marginBottom: 0, fontSize: 18 }}>{d.explain3 || ''}</p>
      </div>
      <WebFolio folio={d.folio} totalPages={totalPages} fallback="09" />
    </WebPage>
  );
}
