'use client';

import type { Locale } from '@/lib/i18n/routing';
import { Brand } from './Brand';
import { Sidebar, type AppNav } from './Sidebar';
import { ChromeStatusBar } from './ChromeStatusBar';

interface Props {
  locale: Locale;
  activeNav: AppNav;
  children: React.ReactNode;
}

export function AppChrome({ locale, activeNav, children }: Props) {
  return (
    <div className="flex min-h-screen">
      <Sidebar locale={locale} activeNav={activeNav} />
      <div className="flex flex-1 flex-col min-h-screen">
        <nav className="sticky top-0 z-[100] backdrop-blur-xl bg-[rgba(245,245,245,0.55)]">
          <div className="mx-auto flex max-w-[1320px] items-center justify-between px-8 py-3">
            <Brand href={`/${locale}`} />
            <ChromeStatusBar locale={locale} />
          </div>
        </nav>
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
