import Link from 'next/link';

interface Props {
  href: string;
  className?: string;
  label?: string;
  markSize?: number;
}

interface BrandMarkProps {
  className?: string;
  /** Rendered height in px; the SVG wordmark scales its width automatically. */
  size?: number;
  /** Accessible name. Empty string keeps the mark decorative (aria-hidden). */
  alt?: string;
}

export const BRAND_LOGO_SRC = '/brand/yujee-logo.svg';

// The brand asset is the full "Yujee" wordmark (wide SVG lockup), used standalone
// per the v1 design — render it at a fixed height with auto width, never boxed
// into a square. See design-v1/design-systems/yujee/DESIGN.md.
export function BrandMark({ className = '', size = 30, alt = '' }: BrandMarkProps) {
  return (
    <img
      src={BRAND_LOGO_SRC}
      alt={alt}
      aria-hidden={alt ? undefined : 'true'}
      height={size}
      className={`block w-auto shrink-0 object-contain ${className}`}
      style={{ height: size }}
    />
  );
}

export function Brand({ href, className = '', label = 'Yujee', markSize = 30 }: Props) {
  return (
    <Link
      href={href}
      className={`flex items-center tracking-tight ${className}`}
      aria-label={label}
    >
      <BrandMark size={markSize} alt={label} />
    </Link>
  );
}
