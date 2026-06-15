import { COLORS, WEB_FONTS } from '../constants';
import { WebFolio, WebImage, WebPage } from '../web-utils';
import type { GridCell, TemplateData, TemplateRenderProps } from '../types';

export function WebMag10({ data, totalPages }: TemplateRenderProps) {
  const d = data as TemplateData & { cells?: GridCell[]; folio?: string };
  const fallbackCells: GridCell[] = [
    { n: '09', image: '', caption: '' },
    { n: '10', image: '', caption: '' },
    { n: '11', image: '', caption: '' },
    { n: '12', image: '', caption: '' },
  ];
  const cells = d.cells ?? fallbackCells;
  // 老仓还支持 cells[0].image 形式直接覆盖 src,这里把 cells[i].image 合并进 cell.image
  const merged = cells.map((c, i) => ({
    ...c,
    image: c.image || (d[`cells[${i}].image`] as string | undefined) || '',
  }));
  return (
    <WebPage fontFamily={WEB_FONTS.sansEn}>
      <div
        style={{
          position: 'absolute',
          top: 130,
          left: 60,
          right: 60,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          columnGap: 50,
          rowGap: 50,
        }}
      >
        {merged.map((c, i) => (
          <div key={c.n ?? i}>
            <div
              style={{
                fontFamily: WEB_FONTS.serifEn,
                fontSize: 22,
                letterSpacing: '0.04em',
                color: COLORS.ink,
                marginBottom: 12,
              }}
            >
              {i + 1}
            </div>
            <WebImage
              src={c.image}
              placeholder="9:8"
              style={{ display: 'block', width: '100%', height: 280 }}
            />
            <p
              style={{
                margin: '12px 0 0',
                lineHeight: 1.7,
                color: COLORS.ink2,
                letterSpacing: '0.02em',
                textAlign: 'justify',
                fontSize: 18,
              }}
            >
              {c.caption}
            </p>
          </div>
        ))}
      </div>
      <WebFolio folio={d.folio} totalPages={totalPages} fallback="10" />
    </WebPage>
  );
}
