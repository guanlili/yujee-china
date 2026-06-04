'use client';

import { useEffect, useState } from 'react';
import type { Locale } from '@/lib/i18n/routing';
import type { MarketingMessages } from '@/messages/marketing';
import { Brand } from '@/components/app/Brand';
import { ChromeStatusBar } from '@/components/app/ChromeStatusBar';

interface Props {
  locale: Locale;
  m: MarketingMessages;
}

export function MarketingNav({ locale, m }: Props) {
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
        <Brand href={`/${locale}`} label={m.nav.brand} />
        <ChromeStatusBar locale={locale} showPricing />
      </div>
    </nav>
  );
}
