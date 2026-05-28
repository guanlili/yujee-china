import { COLORS, WEB_FONTS } from '../constants';
import { WebImage, WebPage, brToReact } from '../web-utils';
import type { TemplateRenderProps } from '../types';

export function WebP01({ data }: TemplateRenderProps) {
  const d = data as {
    image?: string;
    title?: string;
    body?: string;
    category?: string;
    vol?: string;
    date?: string;
  };
  return (
    <WebPage dark fontFamily={WEB_FONTS.serifCn}>
      <WebImage
        src={d.image}
        placeholder="4:5"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 320 }}
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
          color: COLORS.paper70,
          mixBlendMode: 'difference',
          fontSize: 14,
        }}
      >
        <span>
          VOL. {d.vol || '01'} · {d.date || '2026'}
        </span>
        <span>人　生　誌</span>
      </div>
      <div
        style={{
          position: 'absolute',
          top: 70,
          right: 56,
          fontFamily: WEB_FONTS.serifEn,
          fontStyle: 'italic',
          fontSize: 100,
          lineHeight: 0.9,
          color: COLORS.paper92,
          mixBlendMode: 'difference',
        }}
      >
        {d.vol || '01'}
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
            fontFamily: WEB_FONTS.serifEn,
            fontStyle: 'italic',
            letterSpacing: '0.04em',
            color: COLORS.vermilionSoft,
            fontSize: 16,
          }}
        >
          {d.category || 'nº 01 · Portrait'}
        </div>
        <h1
          style={{
            margin: '8px 0 0',
            fontFamily: WEB_FONTS.serifCn,
            fontWeight: 500,
            letterSpacing: '0.04em',
            lineHeight: 1.15,
            color: COLORS.paper,
            fontSize: 46,
          }}
        >
          {brToReact(d.title || '页面标题')}
        </h1>
        <div style={{ marginTop: 22 }}>
          <p
            style={{
              margin: 0,
              fontFamily: WEB_FONTS.serifCn,
              lineHeight: 1.85,
              color: COLORS.paper78,
              textAlign: 'justify',
              fontSize: 16,
            }}
          >
            {d.body || ''}
          </p>
        </div>
      </div>
    </WebPage>
  );
}
