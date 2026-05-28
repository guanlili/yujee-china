import { COLORS, WEB_FONTS } from '../constants';
import { WebFolio, WebPage } from '../web-utils';
import type { TemplateRenderProps, ToCItem } from '../types';

export function WebMag02({ data, totalPages }: TemplateRenderProps) {
  const d = data as { items?: ToCItem[]; folio?: string };
  const items = d.items ?? [{ n: '1', title: 'Title', body: 'Description' }];
  return (
    <WebPage fontFamily={WEB_FONTS.sansEn}>
      <div style={{ position: 'absolute', top: 110, left: 56, fontSize: 16, letterSpacing: '0.36em' }}>
        CONTENT
      </div>
      <div
        style={{
          position: 'absolute',
          top: 180,
          left: 56,
          right: 56,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          rowGap: 60,
          columnGap: 80,
        }}
      >
        {items.map((it, i) => (
          <div key={it.n ?? i}>
            <div
              style={{
                fontSize: 36,
                fontFamily: WEB_FONTS.serifEn,
                fontStyle: 'italic',
                color: COLORS.ink,
                marginBottom: 6,
              }}
            >
              {it.n}
            </div>
            <div
              style={{
                fontSize: 13.5,
                letterSpacing: '0.32em',
                textTransform: 'uppercase',
                color: COLORS.ink2,
                marginBottom: 10,
              }}
            >
              {it.title}
            </div>
            <div
              style={{
                lineHeight: 1.85,
                color: COLORS.ink2,
                textAlign: 'justify',
                letterSpacing: '0.02em',
                fontSize: 16,
              }}
            >
              {it.body}
            </div>
          </div>
        ))}
      </div>
      <WebFolio folio={d.folio} totalPages={totalPages} fallback="02" />
    </WebPage>
  );
}
