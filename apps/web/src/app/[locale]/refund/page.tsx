import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { MarketingChrome } from '@/components/marketing/MarketingChrome';
import { isLocale, type Locale } from '@/lib/i18n/routing';
import { publicPageMetadata } from '@/lib/seo/metadata';
import { getMarketingMessages } from '@/messages/marketing';

interface Props {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const m = getMarketingMessages(locale).refund;
  return publicPageMetadata('/refund', locale, m.metaTitle, m.metaDesc);
}

// Refund policy. Same template as /terms and /privacy — the three legal pages
// differ only in prose, so they share a shape and cannot drift apart visually.
// Payment providers ask for a reachable refund policy during merchant review,
// which is why this exists before checkout is switched on.
export default async function RefundPage({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const m = getMarketingMessages(locale as Locale).refund;

  return (
    <MarketingChrome locale={locale as Locale} pathname="/refund">
      <article className="max-w-3xl mx-auto px-6 md:px-8 pt-16 pb-24">
        <header className="mb-12">
          <h1 className="font-bold text-4xl md:text-5xl tracking-tight mb-3">{m.title}</h1>
          <p className="text-[var(--muted)] text-sm">{m.effective}</p>
        </header>
        <div className="space-y-8 text-[var(--fg-2)]">
          {m.sections.map((section) => (
            <section key={section.h}>
              <h2 className="text-xl font-bold tracking-tight mb-3 text-[var(--fg)]">{section.h}</h2>
              {section.body ? (
                <p className="text-[15px] leading-[1.75] whitespace-pre-line">{section.body}</p>
              ) : (
                <p className="text-[15px] leading-[1.75]">{m.contactLine}</p>
              )}
            </section>
          ))}
        </div>
      </article>
    </MarketingChrome>
  );
}
