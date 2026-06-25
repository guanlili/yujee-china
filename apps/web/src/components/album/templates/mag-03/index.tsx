import { COLORS, WEB_FONTS } from '../constants';
import { WebFolio, WebImage, WebPage } from '../web-utils';
import type { TemplateRenderProps } from '../types';
import { resolveThemeCarrier } from '../theme-carrier';

export function WebMag03({ data, totalPages, imagePos }: TemplateRenderProps) {
  const d = data as {
    label?: string;
    date?: string;
    folio?: string;
    image?: string;
  };
  const labelTheme = resolveThemeCarrier(data, 'label');
  // 装饰：与标签同色（参与主题换肤）的四角框线，压在图片之上（类似杂志取景角标）。
  const decorColor = labelTheme.accentColor ?? COLORS.ink;
  const corners = [
    { top: 94, left: 64, sides: ['Top', 'Left'] },
    { top: 94, left: 702, sides: ['Top', 'Right'] },
    { top: 963, left: 64, sides: ['Bottom', 'Left'] },
    { top: 963, left: 702, sides: ['Bottom', 'Right'] },
  ] as const;
  return (
    <WebPage fontFamily={WEB_FONTS.sansEn}>
      <WebImage
        src={d.image}
        placeholder="3:4"
        style={{ position: 'absolute', top: 80, left: 50, right: 50, height: 925 }}
        position={imagePos?.['image']}
        slotId="image"
      />
      {corners.map((c, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            top: c.top,
            left: c.left,
            width: 30,
            height: 30,
            ...Object.fromEntries(c.sides.map((s) => [`border${s}`, `2px solid ${decorColor}`])),
          }}
        />
      ))}
      <div
        style={{
          position: 'absolute',
          bottom: 50,
          left: 50,
          right: 50,
        }}
      >
        <div
          style={{
            // 小标签(京都 ·):字号砍半(30→15),作为日期上方的小字 kicker;Montserrat 大写 + 宽字距(主题艺术字可覆盖)。
            letterSpacing: '0.38em',
            color: labelTheme.accentColor ?? COLORS.ink,
            textTransform: 'uppercase',
            fontSize: 15,
            fontWeight: 600,
            fontFamily: labelTheme.webFontFamily ?? WEB_FONTS.montserrat,
          }}
        >
          {labelTheme.text ?? d.label ?? ''}
        </div>
        {d.date ? (
          <div
            style={{
              // 日期(03 / 30):字号 30,作为下方较大的一部分。
              marginTop: 6,
              letterSpacing: '0.1em',
              color: labelTheme.accentColor ?? COLORS.ink,
              fontSize: 30,
              fontWeight: 600,
              fontFamily: labelTheme.webFontFamily ?? WEB_FONTS.montserrat,
            }}
          >
            {d.date}
          </div>
        ) : null}
      </div>
      <WebFolio folio={d.folio} totalPages={totalPages} fallback="03" />
    </WebPage>
  );
}
