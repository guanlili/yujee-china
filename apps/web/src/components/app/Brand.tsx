import Link from 'next/link';

interface Props {
  href: string;
  className?: string;
  label?: string;
  markSize?: number;
}

interface BrandMarkProps {
  className?: string;
  size?: number;
}

export const BRAND_LOGO_SRC = '/brand/yujee-logo.webp';

export function BrandMark({ className = '', size = 24 }: BrandMarkProps) {
  const classes = className || 'rounded-md';

  return (
    <img
      src={BRAND_LOGO_SRC}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      className={`block shrink-0 object-cover ${classes}`}
      style={{ width: size, height: size }}
    />
  );
}

export function Brand({ href, className = '', label = 'Yujee', markSize = 24 }: Props) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-2.5 font-extrabold text-[var(--text-xl)] tracking-tight text-[var(--fg)] ${className}`}
    >
      <BrandMark size={markSize} />
      <span>{label}</span>
    </Link>
  );
}
