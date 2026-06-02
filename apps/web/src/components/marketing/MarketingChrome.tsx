import Link from 'next/link';
import { type Locale, locales } from '@/lib/i18n/routing';
import { getMarketingMessages } from '@/messages/marketing';
import { Sidebar } from '@/components/app/Sidebar';

interface Props {
  locale: Locale;
  /** Current path without locale prefix, used to build cross-locale links. e.g. '/pricing' */
  pathname: string;
  children: React.ReactNode;
}

export function MarketingChrome({ locale, pathname, children }: Props) {
  const m = getMarketingMessages(locale);
  const otherLocale: Locale = locales.find((l) => l !== locale) ?? 'en';
  const altPath = pathname === '/' ? `/${otherLocale}` : `/${otherLocale}${pathname}`;

  return (
    <div className="min-h-screen flex flex-col">
      <Sidebar locale={locale} activeNav={pathname === '/' ? 'home' : null} />
      <nav className="sticky top-0 z-50 backdrop-blur-md bg-[rgba(245,245,245,0.6)] border-b border-[var(--border-soft)]">
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

      <main className="flex-1">{children}</main>

      <footer className="bg-[var(--bg)] text-[var(--muted)] mt-16 border-t border-[var(--border-soft)]">
        <div className="max-w-[1100px] mx-auto px-6 md:px-8 pt-16 pb-8 flex flex-col md:flex-row md:justify-between gap-12">
          <div className="max-w-xs">
            <div className="flex items-center gap-2.5 text-xl font-bold text-[var(--fg)] mb-3">
              <span className="w-5.5 h-5.5 w-[22px] h-[22px] rounded-md bg-gradient-to-br from-[var(--grad-green)] via-[var(--grad-purple)] to-[var(--grad-lime)]" />
              <span>Yujee</span>
            </div>
            <p className="text-sm leading-relaxed text-[var(--meta)]">{m.footer.tagline}</p>
          </div>
          <div className="flex gap-14">
            <div>
              <h4 className="text-sm font-semibold text-[var(--fg)] mb-4 tracking-wide">{m.footer.productHead}</h4>
              {m.footer.productItems.map((item) => (
                <Link
                  key={item.href}
                  href={`/${locale}${item.href}`}
                  className="block text-sm text-[var(--meta)] hover:text-[var(--fg)] py-1"
                >
                  {item.label}
                </Link>
              ))}
            </div>
            <div>
              <h4 className="text-sm font-semibold text-[var(--fg)] mb-4 tracking-wide">{m.footer.legalHead}</h4>
              {m.footer.legalItems.map((item) => (
                <Link
                  key={item.href}
                  href={`/${locale}${item.href}`}
                  className="block text-sm text-[var(--meta)] hover:text-[var(--fg)] py-1"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
        <div className="max-w-[1100px] mx-auto px-6 md:px-8 pb-8 pt-6 border-t border-[var(--border-soft)] text-xs text-[var(--meta)]">
          {m.footer.copy}
        </div>
      </footer>
    </div>
  );
}
