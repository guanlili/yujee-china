import Link from 'next/link';
import type { Metadata } from 'next';
import { MarketingChrome } from '@/components/marketing/MarketingChrome';
import { isLocale, type Locale } from '@/lib/i18n/routing';
import { getMarketingMessages } from '@/messages/marketing';
import { notFound } from 'next/navigation';

interface Props {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const m = getMarketingMessages(locale);
  return { title: m.landing.metaTitle, description: m.landing.metaDesc };
}

export default async function LandingPage({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const m = getMarketingMessages(locale as Locale).landing;

  return (
    <MarketingChrome locale={locale as Locale} pathname="/">
      <section className="relative px-6 md:px-8 pt-24 md:pt-32 pb-16 md:pb-24 flex flex-col items-center text-center overflow-hidden">
        <div
          aria-hidden
          className="absolute inset-0 -z-10 pointer-events-none opacity-60"
          style={{
            background:
              'radial-gradient(ellipse 60% 50% at 50% 30%, rgba(140,94,244,0.15) 0%, transparent 70%), radial-gradient(ellipse 50% 40% at 20% 80%, rgba(23,225,135,0.15) 0%, transparent 70%), radial-gradient(ellipse 50% 40% at 80% 20%, rgba(218,244,94,0.12) 0%, transparent 70%)',
          }}
        />
        <h1 className="font-extrabold text-[clamp(36px,6vw,56px)] leading-[1.1] tracking-[-0.03em] text-[var(--fg)] mb-4 max-w-3xl">
          {m.heroTitle}
        </h1>
        <p className="text-lg text-[var(--muted)] max-w-md mx-auto mb-10 leading-relaxed">{m.heroSub}</p>

        <div
          className="relative rounded-2xl p-[2px] max-w-md w-full"
          style={{
            background: 'linear-gradient(135deg, var(--grad-green), var(--grad-purple), var(--grad-lime))',
            boxShadow: '0 0 20px rgba(23,225,135,0.15), 0 0 40px rgba(140,94,244,0.1), 0 0 60px rgba(218,244,94,0.08)',
          }}
        >
          <Link
            href={`/${locale}/create`}
            className="flex items-center justify-center gap-2 w-full px-8 py-4 rounded-2xl bg-[var(--surface)] text-[var(--fg)] text-base font-semibold hover:bg-[#f9f9f9] transition-colors"
          >
            <span>{m.heroCta}</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </Link>
        </div>

        <p className="mt-4 text-xs text-[var(--meta)]">{m.heroTip}</p>
      </section>

      <section className="max-w-[1100px] mx-auto px-6 md:px-8 py-16 md:py-24">
        <div className="flex items-end justify-between mb-12 flex-wrap gap-2">
          <div>
            <div className="text-xs font-medium tracking-widest uppercase text-[var(--meta)] mb-3">{m.featuresLabel}</div>
            <h2 className="text-3xl md:text-[32px] font-bold tracking-tight">{m.featuresTitle}</h2>
          </div>
          <span className="text-sm text-[var(--muted)]">{m.featuresSub}</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {m.features.map((f) => (
            <div
              key={f.num}
              className="bg-[var(--surface)] p-8 rounded-2xl shadow-[var(--shadow-card)] hover:-translate-y-0.5 hover:bg-[#f9f9f9] transition-all"
            >
              <div className="font-medium text-[11px] tracking-widest text-[var(--meta)] mb-5">{f.num}</div>
              <h3 className="font-bold text-lg tracking-tight mb-2.5">{f.title}</h3>
              <p className="text-sm text-[var(--muted)] leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="text-center py-20 md:py-24 px-6">
        <h2 className="font-extrabold text-[clamp(28px,4vw,40px)] tracking-tight mb-4">{m.ctaTitle}</h2>
        <p className="text-[var(--muted)] mb-8 text-base">{m.ctaSub}</p>
        <Link
          href={`/${locale}/create`}
          className="inline-flex items-center gap-2 px-8 py-3.5 rounded-full bg-[var(--fg)] text-white text-sm font-semibold shadow-md hover:-translate-y-0.5 transition-transform"
        >
          <span>{m.ctaButton}</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
        </Link>
      </section>
    </MarketingChrome>
  );
}
