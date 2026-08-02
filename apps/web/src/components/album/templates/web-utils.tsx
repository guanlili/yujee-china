import type { CSSProperties, ReactNode } from 'react';
import { COLORS, PAGE, WEB_FONTS, pageBox } from './constants';

interface WebPageProps {
  children: ReactNode;
  dark?: boolean;
  fontFamily?: string;
  className?: string;
  // 跨页(#303):传入则按该模板的画布尺寸开盒(spread 模板双宽)。
  // 不传 = A4,与改动前逐像素一致 —— 现有模板一律不传。
  templateId?: string;
}

export function WebPage({ children, dark, fontFamily, className, templateId }: WebPageProps) {
  const box = templateId ? pageBox(templateId) : { width: PAGE.width, height: PAGE.height };
  return (
    <div
      className={className}
      style={{
        position: 'relative',
        width: box.width,
        height: box.height,
        background: dark ? COLORS.ink : '#FFFFFF',
        color: dark ? COLORS.paper : COLORS.ink,
        overflow: 'hidden',
        boxSizing: 'border-box',
        fontFamily: fontFamily ?? WEB_FONTS.sansEn,
      }}
    >
      {children}
    </div>
  );
}

interface WebImageProps {
  src?: string;
  placeholder?: string;
  style: CSSProperties;
  // #165 per-slot override. Absent => centered cover, no zoom (pre-#165 default).
  // rotate(2026-08-02):顺时针 90 的倍数,缺省即 0;渲染用「盒交换」,见下。
  position?: { x: number; y: number; scale: number; rotate?: number };
  // #168: the page's image-slot key (same key as imagePos[slotId]). Emitted as
  // data-image-slot so the editor's manual pan/zoom overlay can map a clicked
  // <img> back to its slot and persist the move into imagePosJson[slotId].
  slotId?: string;
}

export function WebImage({ src, placeholder, style, position, slotId }: WebImageProps) {
  if (src) {
    const objectPosition = position ? `${position.x}% ${position.y}%` : '50% 50%';
    // scale>1 zooms in around the focal point; transformOrigin matches the
    // object-position so the zoom keeps the chosen subject framed.
    const zoom: CSSProperties =
      position && position.scale > 1
        ? {
            transform: `scale(${position.scale})`,
            transformOrigin: `${position.x}% ${position.y}%`,
          }
        : {};
    // #168: the caller `style` is the SLOT geometry (position/top/left/width/...).
    // It defines the fixed frame. We give it to an `overflow:hidden` wrapper <div>
    // so a scaled-up <img> is CLIPPED to the frame instead of growing the slot box
    // and shoving neighboring content (the original bug: scale was applied to the
    // <img> which *was* the slot, with no clip container around it). The inner
    // <img> fills the wrapper 100%×100% and keeps the paint props (object-fit/
    // object-position/transform), so at scale=1 it covers the exact same pixels as
    // before — pixel-identical, the wrapper's clip only ever bites once scale>1.
    // `objectFit`/`objectPosition` belong to the img, never the wrapper: strip them
    // out of the wrapper style (some templates inline objectFit:'cover' in `style`).
    const { objectFit: _of, objectPosition: _op, ...frame } = style;
    // ── 旋转:盒交换(2026-08-02,与 page-html-dom.patchHtmlImagePos 同一模型)──
    // 90/270 时 img 的盒尺寸换成图框转置尺寸再绕中心 rotate:cover 在转置盒上按
    // 最小缩放覆盖,白边不变式照旧;不做按宽高比的补偿放大。图框尺寸解析不出
    // (百分比布局)→ 按未旋转渲染,宁可方向不对也不出白边。
    const rotate = position?.rotate ? ((Math.round(position.rotate / 90) * 90) % 360 + 360) % 360 : 0;
    const px = (v: CSSProperties['width']): number | null => {
      if (typeof v === 'number') return v > 0 ? v : null;
      if (typeof v === 'string' && /^[\d.]+px$/.test(v)) return parseFloat(v) || null;
      return null;
    };
    const fw = px(frame.width);
    const fh = px(frame.height);
    const rotated = rotate !== 0 && fw !== null && fh !== null;
    const swap = rotated && rotate % 180 !== 0;
    return (
      <div
        style={{
          ...frame,
          overflow: 'hidden',
          ...(rotated && !frame.position ? { position: 'relative' } : {}),
        }}
      >
        <img
          src={src}
          alt=""
          data-image-slot={slotId}
          style={{
            display: 'block',
            objectFit: 'cover',
            objectPosition,
            ...(rotated
              ? {
                  position: 'absolute',
                  left: '50%',
                  top: '50%',
                  width: `${swap ? fh! : fw!}px`,
                  height: `${swap ? fw! : fh!}px`,
                  transform: `translate(-50%, -50%) rotate(${rotate}deg)${position && position.scale > 1 ? ` scale(${position.scale})` : ''}`,
                }
              : { width: '100%', height: '100%', ...zoom }),
          }}
        />
      </div>
    );
  }
  return (
    <div
      style={{
        background: '#e8e4db',
        color: '#b0a99a',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: WEB_FONTS.sansEn,
        fontSize: 12,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        userSelect: 'none',
        ...style,
      }}
    >
      {placeholder ?? ''}
    </div>
  );
}

interface WebFolioProps {
  folio?: string;
  totalPages?: number;
  fallback: string;
  accentColor?: string;
  fontFamily?: string;
}

export function WebFolio({ folio, totalPages, fallback, accentColor, fontFamily }: WebFolioProps) {
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 40,
        right: 50,
        fontFamily: fontFamily ?? WEB_FONTS.serifEn,
        fontStyle: 'italic',
        fontSize: 22,
        color: accentColor ?? COLORS.ink,
      }}
    >
      {folio || fallback}
      <span style={{ color: COLORS.ink3 }}>/{totalPages ?? ''}</span>
    </div>
  );
}

export function brToReact(s?: string): ReactNode {
  if (!s) return null;
  const lines = s.split('\n');
  return lines.map((line, i) => (
    <span key={i}>
      {line}
      {i < lines.length - 1 ? <br /> : null}
    </span>
  ));
}
