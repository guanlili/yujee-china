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
        background: dark ? COLORS.ink : COLORS.paper,
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
}

export function WebImage({ src, placeholder, style }: WebImageProps) {
  if (src) {
    return (
      <img
        src={src}
        alt=""
        style={{
          display: 'block',
          ...style,
          objectFit: 'cover',
          objectPosition: '50% 50%',
        }}
      />
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
}

export function WebFolio({ folio, totalPages, fallback }: WebFolioProps) {
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 40,
        right: 50,
        fontFamily: WEB_FONTS.serifEn,
        fontStyle: 'italic',
        fontSize: 22,
        color: COLORS.ink,
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
