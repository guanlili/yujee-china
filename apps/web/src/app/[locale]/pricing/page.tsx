import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { MarketingChrome } from '@/components/marketing/MarketingChrome';
import { PricingPlans } from '@/components/marketing/PricingPlans';
import { ADDON_PACKS } from '@/config/pricing';
import { isLocale, type Locale } from '@/lib/i18n/routing';
import { getMarketingMessages } from '@/messages/marketing';

interface Props {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return { title: getMarketingMessages(locale).pricing.metaTitle };
}

export default async function PricingPage({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const m = getMarketingMessages(locale as Locale).pricing;

  return (
    <MarketingChrome locale={locale as Locale} pathname="/pricing">
      <div
        aria-hidden
        className="fixed inset-0 -z-10 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 80% 60% at 0% 0%, rgba(23,225,135,0.07) 0%, transparent 70%), radial-gradient(ellipse 60% 70% at 50% 100%, rgba(140,94,244,0.06) 0%, transparent 70%), radial-gradient(ellipse 70% 50% at 100% 20%, rgba(218,244,94,0.06) 0%, transparent 70%)',
        }}
      />
      <section className="max-w-[1100px] mx-auto px-6 md:px-8 pt-16 md:pt-20 pb-16">
        <header className="text-center mb-12">
          <h1 className="font-bold text-3xl md:text-[32px] tracking-tight mb-2">{m.heading}</h1>
          <p className="text-base text-[var(--muted)]">{m.sub}</p>
        </header>

        <PricingPlans messages={m} />

        <div className="mb-20">
          <h2 className="text-xl font-bold tracking-tight mb-2">{m.addonsTitle}</h2>
          <p className="text-sm text-[var(--muted)] mb-7">{m.addonsSub}</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {ADDON_PACKS.map((pack) => (
              <div
                key={pack.id}
                className="bg-[var(--surface)] rounded-2xl p-6 text-center shadow-[var(--shadow-card)] hover:-translate-y-0.5 transition-all"
              >
                <div className="text-3xl font-extrabold tracking-tight tabular-nums mb-1">
                  {pack.credits.toLocaleString()}
                </div>
                <div className="text-xs text-[var(--muted)] mb-4">{m.addonCreditsLabel}</div>
                <div className="text-xl font-bold mb-1">${pack.priceUsd}</div>
                <div className="text-xs text-[var(--meta)] mb-4">
                  ${(pack.priceUsd / pack.credits).toFixed(4)} / credit
                </div>
                <button
                  type="button"
                  className="w-full py-2.5 text-sm font-semibold rounded-full border border-[var(--fg)] text-[var(--fg)] hover:bg-[var(--fg)] hover:text-white transition-colors"
                >
                  {m.addonBuy}
                </button>
              </div>
            ))}
          </div>
          <p className="text-xs text-[var(--meta)] mt-4 text-center">{m.addonsNote}</p>
        </div>

        <div>
          <h2 className="text-xl font-bold tracking-tight mb-7">{m.faqTitle}</h2>
          <div className="flex flex-col gap-2">
            {m.faq.map((item, idx) => (
              <details
                key={idx}
                className="bg-[var(--surface)] rounded-2xl shadow-[var(--shadow-card)] overflow-hidden group"
              >
                <summary className="flex items-center justify-between px-6 py-5 cursor-pointer text-base font-semibold hover:bg-black/[0.02] list-none [&::-webkit-details-marker]:hidden">
                  <span>{item.q}</span>
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="w-4.5 h-4.5 w-[18px] h-[18px] text-[var(--meta)] flex-shrink-0 transition-transform group-open:rotate-180"
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </summary>
                <div className="px-6 pb-5 text-sm text-[var(--muted)] leading-relaxed">{item.a}</div>
              </details>
            ))}
          </div>
        </div>
      </section>
    </MarketingChrome>
  );
}
