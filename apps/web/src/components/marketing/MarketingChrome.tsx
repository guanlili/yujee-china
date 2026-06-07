import type { Locale } from '@/lib/i18n/routing';
import { getMarketingMessages } from '@/messages/marketing';
import { Sidebar } from '@/components/app/Sidebar';
import { MarketingNav } from './MarketingNav';
import { MarketingFooter } from './MarketingFooter';

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

      <MarketingFooter locale={locale} />
    </div>
  );
}
