import { COLORS, WEB_FONTS } from '../constants';
import { WebFolio, WebImage, WebPage, brToReact } from '../web-utils';
import type { TemplateRenderProps } from '../types';
import { resolveThemeCarrier } from '../theme-carrier';

export function WebMag07({ data, totalPages, imagePos }: TemplateRenderProps) {
  const d = data as {
    image1?: string;
    image2?: string;
    explain1?: string;
    explain2?: string;
    title?: string;
    folio?: string;
  };
  const titleTheme = resolveThemeCarrier(data, 'title');
  // ── 各槽位几何（直接改这里的数字即可调 位置/宽高/字号）──
  // 坐标系：整页 794×1123 px，左上角 (0,0)，单位 px。
  const LAYOUT = {
    caption1: { x: 50, y: 150, w: 240, h: 330, fontSize: 18 }, // 文本框1（上）：x/y 位置、h 高度、fontSize 字号均可编辑
    caption2: { x: 50, y: 510, w: 240, h: 420, fontSize: 18 }, // 文本框2（下，对齐大图）：x/y 位置、h 高度、fontSize 字号均可编辑
    title: { x: 50, bottom: 70, fontSize: 104 }, // 标题（贴底；bottom 越大越往上）展示级 Bebas Neue 大字
    image1: { x: 364, y: 90, w: 380, h: 330 }, // 上方横图
    image2: { x: 364, y: 450, w: 380, h: 480 }, // 下方竖图（大）
  };
  const captionStyle = {
    margin: 0,
    fontFamily: WEB_FONTS.montserrat, // 图注：Montserrat（带中文回退），保持可读
    lineHeight: 1.7,
    color: COLORS.ink2,
    textAlign: 'justify' as const,
    letterSpacing: '0.02em',
  };
  return (
    <WebPage fontFamily={WEB_FONTS.sansEn}>
      <div
        style={{
          position: 'absolute',
          top: LAYOUT.caption1.y,
          left: LAYOUT.caption1.x,
          width: LAYOUT.caption1.w,
          height: LAYOUT.caption1.h,
        }}
      >
        <p style={{ position: 'absolute', left: 10, top: 20, width: 240, height: 27, ...captionStyle, fontSize: LAYOUT.caption1.fontSize }}>{d.explain1 || ''}</p>
      </div>
      <WebImage
        src={d.image1}
        placeholder="5:3"
        style={{ position: 'absolute', left: 364, top: 60, width: 380, height: 330 }}
        position={imagePos?.['image1']}
        slotId="image1"
      />
      <div
        style={{
          position: 'absolute',
          top: LAYOUT.caption2.y,
          left: LAYOUT.caption2.x,
          width: LAYOUT.caption2.w,
          height: LAYOUT.caption2.h,
        }}
      >
        <p style={{ position: 'absolute', left: 10, top: 60, width: 240, height: 37, ...captionStyle, fontSize: LAYOUT.caption2.fontSize }}>{d.explain2 || ''}</p>
      </div>
      <WebImage
        src={d.image2}
        placeholder="4:5"
        style={{ position: 'absolute', left: 364, top: 450, width: 380, height: 480 }}
        position={imagePos?.['image2']}
        slotId="image2"
      />
      <h1
        style={{
          position: 'absolute',
          bottom: LAYOUT.title.bottom,
          left: LAYOUT.title.x,
          width: 300,
          margin: 0,
          // 主标题：指定艺术字 Bebas Neue（高瘦大写，带中文回退）
          fontFamily: titleTheme.webFontFamily ?? WEB_FONTS.bebas,
          fontSize: LAYOUT.title.fontSize,
          letterSpacing: '0.02em',
          lineHeight: 0.92,
          fontWeight: 400,
          color: titleTheme.accentColor,
        }}
      >
        {brToReact(titleTheme.text ?? d.title ?? 'FUSHI\nINARI')}
      </h1>
      <WebFolio folio={d.folio} totalPages={totalPages} fallback="07" />
    </WebPage>
  );
}
