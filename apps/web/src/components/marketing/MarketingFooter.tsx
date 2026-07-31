import Link from 'next/link';
import type { Locale } from '@/lib/i18n/routing';
import { getMarketingMessages } from '@/messages/marketing';
import { Brand } from '@/components/app/Brand';
import { MarketingSocials } from './MarketingSocials';

interface Props {
  locale: Locale;
}

const LINK_CLASS = 'block text-sm text-[var(--meta)] hover:text-[var(--fg)] py-1';

/**
 * One footer link.
 *
 * `mailto:` must not get the /{locale} prefix — prefixing it produced
 * `/zh/mailto:support@…`, a 404 dressed up as a contact link. Anything else is
 * a locale-relative path or a landing-page anchor and does get the prefix.
 */
function FooterLink({ locale, href, label }: { locale: Locale; href: string; label: string }) {
  if (href.startsWith('mailto:')) {
    return (
      <a href={href} className={LINK_CLASS}>
        {label}
      </a>
    );
  }

  return (
    <Link href={`/${locale}${href}`} className={LINK_CLASS}>
      {label}
    </Link>
  );
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
        <div className="grid grid-cols-2 gap-x-10 gap-y-10 sm:flex sm:flex-wrap sm:gap-x-14">
          {m.footer.groups.map((group) => (
            <div key={group.head}>
              <h4 className="text-sm font-semibold text-[var(--fg)] mb-4 tracking-wide">{group.head}</h4>
              {group.items.map((item) => (
                <FooterLink key={item.href} locale={locale} href={item.href} label={item.label} />
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
