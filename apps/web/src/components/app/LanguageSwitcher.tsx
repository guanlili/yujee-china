'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { type Locale, locales, localizePath } from '@/lib/i18n/routing';
import { CHROME_PILL_BUTTON_CLASS } from './chromeStyles';

interface Props {
  locale: Locale;
}

const LABELS: Record<Locale, string> = { en: 'English', zh: '中文' };

export function LanguageSwitcher({ locale }: Props) {
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
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex ${CHROME_PILL_BUTTON_CLASS} pr-3.5`}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
          <circle cx="12" cy="12" r="10" />
          <line x1="2" y1="12" x2="22" y2="12" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
        <span>{LABELS[locale]}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={`w-3.5 h-3.5 text-[var(--meta)] transition-transform ${open ? 'rotate-180' : ''}`}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="absolute top-[calc(100%+8px)] right-0 min-w-[160px] rounded-[var(--radius-md)] bg-[var(--surface)] p-1.5 shadow-[var(--shadow-card-hover)] z-[200]">
          {locales.map((l) => (
            <Link
              key={l}
              href={localizePath(pathname, l)}
              onClick={() => setOpen(false)}
              className={`flex items-center justify-between rounded-[var(--radius-md)] px-3 py-2 text-[var(--text-sm)] transition-colors ${
                l === locale ? 'font-semibold text-white bg-[var(--fg)]' : 'text-[var(--fg-2)] hover:bg-[var(--bg)]'
              }`}
            >
              {LABELS[l]}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
