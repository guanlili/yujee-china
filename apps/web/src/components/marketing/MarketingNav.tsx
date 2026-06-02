'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { Locale } from '@/lib/i18n/routing';
import type { MarketingMessages } from '@/messages/marketing';

interface Props {
  locale: Locale;
  otherLocale: Locale;
  altPath: string;
  m: MarketingMessages;
}

export function MarketingNav({ locale, otherLocale, altPath, m }: Props) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <nav
      className={`sticky top-0 z-50 transition-[background-color,backdrop-filter,border-color] duration-300 ${
        scrolled
          ? 'backdrop-blur-[20px] bg-[rgba(245,245,245,0.55)] border-b border-[var(--border-soft)]'
          : 'bg-transparent border-b border-transparent'
      }`}
    >
      <div className="max-w-[1320px] mx-auto px-6 md:px-8 py-3 flex items-center justify-between">
        <Link href={`/${locale}`} className="flex items-center gap-2.5 font-extrabold text-xl tracking-tight">
          <span className="w-6 h-6 rounded-md bg-gradient-to-br from-[var(--grad-green)] via-[var(--grad-purple)] to-[var(--grad-lime)] opacity-90" />
          <span>{m.nav.brand}</span>
        </Link>
        <div className="flex items-center gap-2 md:gap-3">
          <Link
            href={`/${locale}/pricing`}
            className="hidden sm:inline-flex px-3 py-1.5 text-sm text-[var(--fg-2)] hover:text-[var(--fg)]"
          >
            {m.nav.pricing}
          </Link>
          <Link
            href={altPath}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#ececec] hover:bg-[#e2e2e2] text-sm text-[var(--muted)] hover:text-[var(--fg)] transition-colors"
            aria-label={`Switch language to ${otherLocale}`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
              <circle cx="12" cy="12" r="10" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
            <span>{otherLocale === 'zh' ? '中文' : 'English'}</span>
          </Link>
          <Link
            href={`/${locale}/login`}
            className="hidden sm:inline-flex px-3 py-1.5 text-sm text-[var(--fg-2)] hover:text-[var(--fg)]"
          >
            {m.nav.login}
          </Link>
          <Link
            href={`/${locale}/create`}
            className="inline-flex px-5 py-2 rounded-full bg-[var(--fg)] text-white text-sm font-semibold shadow-sm hover:-translate-y-0.5 transition-transform"
          >
            {m.nav.getStarted}
          </Link>
        </div>
      </div>
    </nav>
  );
}
