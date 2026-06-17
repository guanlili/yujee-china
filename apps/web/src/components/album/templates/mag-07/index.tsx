import { COLORS, WEB_FONTS } from '../constants';
import { WebFolio, WebImage, WebPage, brToReact } from '../web-utils';
import type { TemplateRenderProps } from '../types';

export function WebMag07({ data, totalPages, imagePos }: TemplateRenderProps) {
  const d = data as {
    imageTop?: string;
    imageMain?: string;
    caption1?: string;
    caption2?: string;
    title?: string;
    folio?: string;
  };
  // ── 各槽位几何（直接改这里的数字即可调 位置/宽高/字号）──
  // 坐标系：整页 794×1123 px，左上角 (0,0)，单位 px。
  const LAYOUT = {
    caption1: { x: 50, y: 150, w: 240, h: 330, fontSize: 18 }, // 文本框1（上）：x/y 位置、h 高度、fontSize 字号均可编辑
    caption2: { x: 50, y: 510, w: 240, h: 420, fontSize: 18 }, // 文本框2（下，对齐大图）：x/y 位置、h 高度、fontSize 字号均可编辑
    title: { x: 50, bottom: 70, fontSize: 56 }, // 标题（贴底；bottom 越大越往上）
    imageTop: { x: 364, y: 90, w: 380, h: 330 }, // 上方横图
    imageMain: { x: 364, y: 450, w: 380, h: 480 }, // 下方竖图（大）
  };
  const captionStyle = {
    margin: 0,
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
        <p style={{ position: 'absolute', left: 10, top: 20, width: 240, height: 27, ...captionStyle, fontSize: LAYOUT.caption1.fontSize }}>{d.caption1 || ''}</p>
      </div>
      <WebImage
        src={d.imageTop}
        placeholder="5:3"
        style={{ position: 'absolute', left: 364, top: 60, width: 380, height: 330 }}
        position={imagePos?.['imageTop']}
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
        <p style={{ position: 'absolute', left: 10, top: 60, width: 240, height: 37, ...captionStyle, fontSize: LAYOUT.caption2.fontSize }}>{d.caption2 || ''}</p>
      </div>
      <WebImage
        src={d.imageMain}
        placeholder="4:5"
        style={{ position: 'absolute', left: 364, top: 450, width: 380, height: 480 }}
        position={imagePos?.['imageMain']}
      />
      <h1
        style={{
          position: 'absolute',
          bottom: LAYOUT.title.bottom,
          left: LAYOUT.title.x,
          margin: 0,
          fontFamily: WEB_FONTS.serifEn,
          fontSize: LAYOUT.title.fontSize,
          letterSpacing: '0.06em',
          lineHeight: 1.15,
          fontWeight: 400,
        }}
      >
        {brToReact(d.title || 'FUSHI\nINARI')}
      </h1>
      <WebFolio folio={d.folio} totalPages={totalPages} fallback="07" />
    </WebPage>
  );
}
