import Link from 'next/link';
import type { Locale } from '@/lib/i18n/routing';
import { getMarketingMessages } from '@/messages/marketing';
import { Brand } from '@/components/app/Brand';
import { MarketingSocials } from './MarketingSocials';

interface Props {
  locale: Locale;
}

// Shared site footer. Rendered by MarketingChrome (landing, pricing, legal) and
// opted into by the logged-in home (/create) so the page reads as a complete
// surface rather than a bare composer.
export function MarketingFooter({ locale }: Props) {
  const m = getMarketingMessages(locale);

  return (
    <footer className="bg-[var(--bg)] text-[var(--muted)] mt-16 border-t border-[var(--border-soft)]">
      <div className="max-w-[1100px] mx-auto px-6 md:px-8 pt-16 pb-8 flex flex-col md:flex-row md:justify-between gap-12">
        <div className="max-w-xs">
          <Brand href={`/${locale}`} className="mb-3" markSize={22} />
          <p className="text-sm leading-relaxed text-[var(--meta)]">{m.footer.tagline}</p>
          <MarketingSocials />
        </div>
        <div className="flex flex-wrap gap-x-14 gap-y-10">
          {[
            { head: m.footer.productHead, items: m.footer.productItems },
            { head: m.footer.aboutHead, items: m.footer.aboutItems },
            { head: m.footer.legalHead, items: m.footer.legalItems },
          ].map((group) => (
            <div key={group.head}>
              <h4 className="text-sm font-semibold text-[var(--fg)] mb-4 tracking-wide">{group.head}</h4>
              {group.items.map((item) => (
                <Link
                  key={item.href}
                  href={`/${locale}${item.href}`}
                  className="block text-sm text-[var(--meta)] hover:text-[var(--fg)] py-1"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="max-w-[1100px] mx-auto px-6 md:px-8 pb-8 pt-6 border-t border-[var(--border-soft)] text-xs text-[var(--meta)]">
        {m.footer.copy}
      </div>
    </footer>
  );
}
