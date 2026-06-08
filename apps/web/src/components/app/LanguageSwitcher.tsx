'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { type Locale, locales, localizePath } from '@/lib/i18n/routing';

interface Props {
  locale: Locale;
  className?: string;
}

const LABELS: Record<Locale, string> = { en: 'English', zh: '中文' };

export function LanguageSwitcher({ locale, className = '' }: Props) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium text-[var(--muted)] bg-black/[0.06] hover:bg-black/[0.1] hover:text-[var(--fg-2)] transition-colors"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
          <circle cx="12" cy="12" r="10" />
          <line x1="2" y1="12" x2="22" y2="12" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
        <span>{LABELS[locale]}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="absolute top-[calc(100%+6px)] right-0 min-w-[140px] bg-[var(--surface)] rounded-xl border border-[var(--border-soft)] shadow-[var(--shadow-card-hover)] p-1.5 z-[200]">
          {locales.map((l) => (
            <Link
              key={l}
              href={localizePath(pathname, l)}
              onClick={() => setOpen(false)}
              className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${
                l === locale ? 'text-[var(--fg)]' : 'text-[var(--fg-2)] hover:bg-[var(--bg)]'
              }`}
            >
              <span>{LABELS[l]}</span>
              {l === locale && <span className="w-4 h-4 text-[var(--fg)]">✓</span>}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
