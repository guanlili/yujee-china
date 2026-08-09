import Link from 'next/link';
import type { ReactNode } from 'react';
import { localizePath, type Locale } from '@/lib/i18n/routing';
import { getFaqEntries } from '@/lib/seo/faq';

/**
 * The FAQ prose lives in @/lib/seo/faq — the same module the FAQPage JSON-LD
 * serialises. Rendering both from one source means the structured data can never
 * claim something the page doesn't actually say.
 *
 * The pricing link is presentation, so it's appended here rather than baked into
 * the schema text (JSON-LD answers must be markup-free).
 */
export function buildFaq(locale: Locale, pricingLabel: string): { q: string; a: ReactNode }[] {
  const entries = getFaqEntries(locale);

  return entries.map((entry, index) => {
    const isLast = index === entries.length - 1;
    if (!isLast) return { q: entry.q, a: entry.a };

    return {
      q: entry.q,
      a: (
        <>
          {entry.a}{' '}
          <Link href={`${localizePath('/', locale)}#pricing`} className="underline underline-offset-2">
            {pricingLabel}
          </Link>
        </>
      ),
    };
  });
}
