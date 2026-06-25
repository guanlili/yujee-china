import { COLORS, WEB_FONTS } from '../constants';
import { WebFolio, WebImage, WebPage } from '../web-utils';
import type { GridCell, TemplateData, TemplateRenderProps } from '../types';

// 重复组 items:image 寻址 image[i]、图说文字寻址 explain[i]。adapt-layout 把
// image[i]/explain[i] 还原成 data.image / data.explain 两个并列数组(元素为
// 字符串或 {body,caption} 对象)。
function cellText(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') {
    const o = v as { body?: string; caption?: string };
    return o.body ?? o.caption ?? '';
  }
  return String(v);
}

export function WebMag10({ data, totalPages, imagePos }: TemplateRenderProps) {
  const d = data as TemplateData & {
    cells?: GridCell[];
    image?: unknown[];
    explain?: unknown[];
    folio?: string;
  };
  const images = Array.isArray(d.image) ? d.image : undefined;
  const explains = Array.isArray(d.explain) ? d.explain : undefined;
  const count = Math.max(images?.length ?? 0, explains?.length ?? 0, d.cells?.length ?? 0, 4);
  // 兼容旧的 cells 对象数组数据;新数据走 image[i]/explain[i] 并列数组
  const merged = Array.from({ length: count }).map((_, i) => {
    const legacy = d.cells?.[i];
    return {
      n: legacy?.n ?? String(i + 9),
      image:
        cellText(images?.[i]) ||
        legacy?.image ||
        (d[`image[${i}]`] as string | undefined) ||
        '',
      caption: cellText(explains?.[i]) || legacy?.caption || '',
    };
  });
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
              position={imagePos?.[`image[${i}]`]}
              slotId={`image[${i}]`}
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
