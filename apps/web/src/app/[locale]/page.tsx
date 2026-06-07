import Link from 'next/link';
import type { Metadata } from 'next';
import { MarketingChrome } from '@/components/marketing/MarketingChrome';
import { FingerprintArt } from '@/components/landing/FingerprintArt';
import { HeroComposer } from '@/components/landing/HeroComposer';
import { InspirationMarquee } from '@/components/landing/InspirationMarquee';
import { PricingSection } from '@/components/marketing/PricingSection';
import { getMessages } from '@/lib/i18n/messages';
import { isLocale, type Locale } from '@/lib/i18n/routing';
import { getMarketingMessages } from '@/messages/marketing';
import { notFound } from 'next/navigation';

interface Props {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ resumeGeneration?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const m = getMarketingMessages(locale);
  return { title: m.landing.metaTitle, description: m.landing.metaDesc };
}

export default async function LandingPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { resumeGeneration } = await searchParams;
  if (!isLocale(locale)) notFound();
  const loc = locale as Locale;
  const m = getMarketingMessages(loc).landing;
  const createMessages = getMessages(loc).dashboard.create;

  return (
    <MarketingChrome locale={loc} pathname="/">
      <section className="relative flex min-h-[520px] flex-col items-center justify-center overflow-hidden px-6 pt-32 pb-20 text-center md:px-8">
        <FingerprintArt />

        <h1 className="z-[1] mb-4 max-w-3xl font-extrabold leading-[1.1] tracking-[-0.03em] text-[var(--fg)] text-[clamp(36px,6vw,56px)]">
          {m.heroTitle}
        </h1>
        <p className="z-[1] mx-auto mb-12 max-w-[480px] text-[var(--text-lg)] leading-relaxed text-[var(--muted)]">
          {m.heroSub}
        </p>

        <HeroComposer
          locale={loc}
          placeholder={m.composerPlaceholder}
          uploadLabel={m.composerUploadLabel}
          hints={m.composerHints}
          createMessages={createMessages}
          resumeGeneration={resumeGeneration === '1'}
        />

        <p className="z-[1] mt-4 text-[var(--text-xs)] text-[var(--meta)]">{m.heroTip}</p>
      </section>

      <div className="relative z-[1] mx-auto w-full max-w-[1100px] px-6 md:px-8">
        <section className="py-20 md:py-24">
          <div className="mb-12 flex items-end justify-between gap-2">
            <h2 className="text-2xl font-bold tracking-tight md:text-[32px]">{m.featuresTitle}</h2>
            <span className="text-sm text-[var(--muted)]">{m.featuresSub}</span>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {m.features.map((f) => (
              <div
                key={f.num}
                className="rounded-2xl bg-[var(--surface)] px-8 py-10 shadow-[var(--shadow-card)] transition-all hover:-translate-y-0.5 hover:bg-[#f9f9f9] hover:shadow-[var(--shadow-card-hover)]"
              >
                <div className="mb-5 text-[11px] tracking-widest text-[var(--meta)]">{f.num}</div>
                <h3 className="mb-2.5 text-[var(--text-lg)] font-bold tracking-tight">{f.title}</h3>
                <p className="text-[var(--text-sm)] leading-[1.8] text-[var(--muted)]">{f.desc}</p>
              </div>
            ))}
          </div>
        </section>

        <InspirationMarquee locale={loc} title={m.casesTitle} more={m.casesMore} cases={m.cases} />
      </div>

      {/* Full-width: PricingSection carries its own gutters + inner max-width,
          so it must not sit inside the 1100px content container (would double the
          horizontal padding). */}
      <PricingSection locale={loc} />

      <div className="relative z-[1] mx-auto w-full max-w-[1100px] px-6 md:px-8">
        <section className="py-20 text-center md:py-24">
          <h2 className="mb-4 font-extrabold tracking-tight text-[clamp(28px,4vw,40px)]">{m.ctaTitle}</h2>
          <p className="mb-8 text-base text-[var(--muted)]">{m.ctaSub}</p>
          <Link
            href={`/${loc}#homepage-composer`}
            className="inline-flex items-center gap-2 rounded-full bg-[var(--fg)] px-8 py-3.5 text-sm font-semibold text-white shadow-md transition-transform hover:-translate-y-0.5"
          >
            <span>{m.ctaButton}</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </Link>
        </section>
      </div>
    </MarketingChrome>
  );
}
