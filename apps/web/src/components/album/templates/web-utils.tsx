import type { CSSProperties, ReactNode } from 'react';
import { COLORS, PAGE, WEB_FONTS } from './constants';

interface WebPageProps {
  children: ReactNode;
  dark?: boolean;
  fontFamily?: string;
  className?: string;
}

export function WebPage({ children, dark, fontFamily, className }: WebPageProps) {
  return (
    <div
      className={className}
      style={{
        position: 'relative',
        width: PAGE.width,
        height: PAGE.height,
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
  position?: { x: number; y: number; scale: number };
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
    return (
      <div
        style={{
          ...frame,
          overflow: 'hidden',
        }}
      >
        <img
          src={src}
          alt=""
          data-image-slot={slotId}
          style={{
            display: 'block',
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition,
            ...zoom,
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
}

export function WebFolio({ folio, totalPages, fallback, accentColor }: WebFolioProps) {
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 40,
        right: 50,
        fontFamily: WEB_FONTS.serifEn,
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
