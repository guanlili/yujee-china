'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { locales, localizePath, type Locale } from '@/lib/i18n/routing';
import type { MarketingMessages } from '@/messages/marketing';
import { Brand } from '@/components/app/Brand';
import { ChromeStatusBar } from '@/components/app/ChromeStatusBar';
import { useChromeSession } from '@/components/app/useChromeSession';

interface Props {
  locale: Locale;
  m: MarketingMessages;
}

export function MarketingNav({ locale, m }: Props) {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const session = useChromeSession();
  const { user } = session;

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const homePath = `/${locale}`;
  const isHome = pathname === homePath || pathname === `${homePath}/`;
  const homeSectionHref = (id: string) => (isHome ? `#${id}` : `${homePath}#${id}`);
  const navItems = [
    { key: 'home', label: m.nav.home, href: homePath, active: isHome },
    ...(user
      ? [{ key: 'myProjects', label: m.nav.myProjects, href: `/${locale}/my-albums`, active: false }]
      : []),
    { key: 'how', label: m.nav.howItWorks, href: homeSectionHref('how'), active: false },
    { key: 'pricing', label: m.nav.pricing, href: homeSectionHref('pricing'), active: false },
  ];

  return (
    <nav
      className={`sticky top-0 z-50 transition-[background-color,backdrop-filter,border-color] duration-300 ${
        scrolled
          ? 'backdrop-blur-[20px] bg-[rgba(245,245,245,0.55)] border-b border-[var(--border-soft)]'
          : 'bg-transparent border-b border-transparent'
      }`}
    >
      <div className="relative mx-auto flex h-16 max-w-[1320px] items-center justify-between gap-4 px-5 sm:px-8">
        <Brand href={`/${locale}`} label={m.nav.brand} />
        <div className="absolute left-1/2 -translate-x-1/2 hidden md:flex items-center gap-1">
          {navItems.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className={`rounded-lg px-4 py-2 text-sm transition-colors hover:bg-black/5 ${
                item.active
                  ? 'font-semibold text-[var(--fg)]'
                  : 'font-medium text-[var(--muted)] hover:text-[var(--fg)]'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ChromeStatusBar locale={locale} languageClassName="hidden sm:block" session={session} />
          <button
            type="button"
            aria-label={m.nav.menuToggle}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((open) => !open)}
            className="grid h-9 w-9 place-items-center rounded-lg text-[var(--fg)] transition-colors hover:bg-black/5 md:hidden"
          >
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5"
            >
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
        </div>
      </div>
      {mobileOpen && (
        <div className="border-t border-[var(--border-soft)] bg-[var(--surface)]/95 px-5 py-3 backdrop-blur md:hidden">
          {navItems.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className={`block rounded-lg px-3 py-2.5 text-base transition-colors hover:bg-[var(--bg)] ${
                item.active ? 'font-semibold text-[var(--fg)]' : 'text-[var(--fg-2)]'
              }`}
            >
              {item.label}
            </Link>
          ))}
          <div className="mt-2 flex gap-2 border-t border-[var(--border-soft)] pt-3">
            {locales.map((l) => (
              <Link
                key={l}
                href={localizePath(pathname, l)}
                onClick={() => setMobileOpen(false)}
                className={`flex-1 rounded-full py-2 text-center text-sm font-medium transition-colors hover:bg-[var(--border-soft)] ${
                  l === locale ? 'bg-[var(--fg)] text-white' : 'bg-[var(--bg)] text-[var(--fg-2)]'
                }`}
              >
                {l === 'zh' ? '中文' : 'English'}
              </Link>
            ))}
          </div>
        </div>
      )}
    </nav>
  );
}
