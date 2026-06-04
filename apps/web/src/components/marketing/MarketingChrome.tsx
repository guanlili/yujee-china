import Link from 'next/link';
import type { Locale } from '@/lib/i18n/routing';
import { getMarketingMessages } from '@/messages/marketing';
import { Brand } from '@/components/app/Brand';
import { Sidebar } from '@/components/app/Sidebar';
import { MarketingNav } from './MarketingNav';
import { MarketingSocials } from './MarketingSocials';

interface Props {
  locale: Locale;
  /** Current path without locale prefix, used to build cross-locale links. e.g. '/pricing' */
  pathname: string;
  children: React.ReactNode;
}

export function MarketingChrome({ locale, pathname, children }: Props) {
  const m = getMarketingMessages(locale);

  return (
    <div className="min-h-screen flex flex-col">
      <Sidebar locale={locale} activeNav={pathname === '/' ? 'home' : null} />
      <MarketingNav locale={locale} m={m} />

      <main className="flex-1">{children}</main>

      <footer className="bg-[var(--bg)] text-[var(--muted)] mt-16 border-t border-[var(--border-soft)]">
        <div className="max-w-[1100px] mx-auto px-6 md:px-8 pt-16 pb-8 flex flex-col md:flex-row md:justify-between gap-12">
          <div className="max-w-xs">
            <Brand href={`/${locale}`} className="mb-3 text-xl" markSize={22} />
            <p className="text-sm leading-relaxed text-[var(--meta)]">{m.footer.tagline}</p>
            <MarketingSocials />
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
