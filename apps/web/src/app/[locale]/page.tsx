import Link from 'next/link';
import type { Metadata } from 'next';
import { MarketingChrome } from '@/components/marketing/MarketingChrome';
import { FingerprintArt } from '@/components/landing/FingerprintArt';
import { HeroComposer } from '@/components/landing/HeroComposer';
import { InspirationMarquee } from '@/components/landing/InspirationMarquee';
import { PricingSection } from '@/components/marketing/PricingSection';
import { FaqList } from '@/components/marketing/FaqList';
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

// Lucide line icons used by the "How it works" steps, keyed by step index.
const HOW_ICONS = [
  // image
  <>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="9" cy="9" r="2" />
    <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
  </>,
  // sparkle / sun
  <>
    <path d="M12 3v2m0 14v2M5.6 5.6l1.4 1.4m10 10 1.4 1.4M3 12h2m14 0h2M5.6 18.4 7 17m10-10 1.4-1.4" />
    <circle cx="12" cy="12" r="4" />
  </>,
  // pencil / edit
  <>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </>,
];

export default async function LandingPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { resumeGeneration } = await searchParams;
  if (!isLocale(locale)) notFound();
  const loc = locale as Locale;
  const m = getMarketingMessages(loc).landing;
  const createMessages = getMessages(loc).dashboard.create;

  return (
    <MarketingChrome locale={loc} pathname="/">
      {/* Smooth-scroll for in-page anchors (hero composer, #how, #pricing).
          Scoped here so globals.css stays untouched. */}
      <style>{`html { scroll-behavior: smooth; }`}</style>

      {/* ═══════════ 1 · HERO ═══════════ */}
      <section className="relative flex flex-col items-center justify-center overflow-hidden px-5 pt-32 pb-20 text-center sm:px-8">
        <FingerprintArt />

        <h1
          className="z-[1] m-0 max-w-[720px] text-center text-[clamp(30px,5.4vw,52px)] font-extrabold leading-[1.14] tracking-[-0.02em] text-[var(--fg)]"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {m.heroTitlePre}
          <span className="bg-[linear-gradient(115deg,var(--grad-green),var(--grad-purple)_50%,var(--grad-lime))] bg-clip-text text-transparent">
            {m.heroTitleHighlight}
          </span>
          {m.heroTitlePost}
        </h1>
        <p className="z-[1] mx-auto mb-9 mt-3.5 max-w-[520px] text-center text-[clamp(15px,2.2vw,19px)] leading-[1.55] text-[var(--muted)]">
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
      </section>

      {/* ═══════════ 2 · How it works · three steps ═══════════ */}
      <section id="how" className="scroll-mt-20 px-5 py-12 sm:px-8 sm:py-16">
        <div className="mx-auto max-w-[1320px]">
          <h2
            className="mb-12 text-center text-[clamp(22px,3.4vw,30px)] font-extrabold leading-[1.25] tracking-[-0.02em] sm:mb-16"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {m.howTitle}
          </h2>
          <div className="grid grid-cols-1 gap-5 sm:gap-6 md:grid-cols-3">
            {m.howSteps.map((step, i) => (
              <div
                key={step.num}
                className="rounded-2xl bg-[var(--surface)] p-7 shadow-[var(--shadow-card)] sm:p-8"
              >
                <div className="mb-5 text-sm font-bold tabular-nums text-[var(--meta)]">
                  {step.num}
                </div>
                <div className="mb-4 grid h-11 w-11 place-items-center rounded-xl bg-[var(--bg)] text-[var(--fg)]">
                  <svg
                    aria-hidden
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-5 w-5"
                  >
                    {HOW_ICONS[i]}
                  </svg>
                </div>
                <h3 className="mb-2 text-lg font-bold">{step.title}</h3>
                <p className="text-sm leading-relaxed text-[var(--muted)]">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════ 3 · What you get ═══════════ */}
      <section className="px-5 py-12 sm:px-8 sm:py-16">
        <div className="mx-auto grid max-w-[1320px] grid-cols-1 items-center gap-8 lg:grid-cols-2 lg:gap-14">
          {/* Left: product screenshot placeholder (4:3, dashed) */}
          <div className="order-2 lg:order-1">
            <div className="grid aspect-[4/3] place-items-center rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] text-center shadow-[var(--shadow-card)]">
              <div className="text-[var(--meta)]">
                <svg
                  aria-hidden
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="mx-auto mb-2 h-8 w-8"
                >
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="9" cy="9" r="2" />
                  <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
                </svg>
                <div className="text-sm">{m.whatYouGetPlaceholder}</div>
              </div>
            </div>
          </div>

          {/* Right: heading + checklist */}
          <div className="order-1 lg:order-2">
            <h2
              className="mb-3 text-[clamp(22px,3.4vw,30px)] font-extrabold leading-[1.25] tracking-[-0.02em]"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {m.whatYouGetTitle}
            </h2>
            <p className="mb-7 leading-relaxed text-[var(--muted)]">{m.whatYouGetSub}</p>
            <ul className="space-y-5">
              {m.whatYouGetItems.map((item) => (
                <li key={item.title} className="flex gap-3.5">
                  <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--bg)] text-[var(--fg)]">
                    <svg
                      aria-hidden
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-3.5 w-3.5"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </span>
                  <div>
                    <div className="mb-0.5 font-semibold">{item.title}</div>
                    <div className="text-sm leading-relaxed text-[var(--muted)]">{item.desc}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ═══════════ 4 · Demo video placeholder ═══════════ */}
      <section className="px-5 py-12 sm:px-8 sm:py-16">
        <div className="mx-auto max-w-[900px] text-center">
          <h2
            className="mb-3 text-[clamp(22px,3.4vw,30px)] font-extrabold leading-[1.25] tracking-[-0.02em]"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {m.demoTitle}
          </h2>
          <p className="mb-8 text-[var(--muted)]">{m.demoSub}</p>
          <div className="grid aspect-video place-items-center rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-card)]">
            <div className="text-center text-[var(--meta)]">
              <span className="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-full bg-[var(--bg)] text-[var(--fg)]">
                <svg aria-hidden viewBox="0 0 24 24" fill="currentColor" className="ml-0.5 h-6 w-6">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </span>
              <div className="text-sm">{m.demoPlaceholder}</div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════ 5 · Inspiration marquee (kept) ═══════════ */}
      <div className="relative z-[1] mx-auto w-full max-w-[1100px] px-6 md:px-8">
        <InspirationMarquee locale={loc} title={m.casesTitle} more={m.casesMore} cases={m.cases} />
      </div>

      {/* ═══════════ 6 · Pricing (full-width; carries its own gutters) ═══════════ */}
      <PricingSection locale={loc} />

      {/* ═══════════ 7 · FAQ ═══════════ */}
      <FaqList title={m.faqTitle} items={m.faq} />

      {/* ═══════════ 8 · End CTA (brand glow — the one halo per page) ═══════════ */}
      <section className="px-5 py-20 text-center sm:px-8 sm:py-28">
        {/* Brand glow halo (DESIGN.md §4): black pill with a blurred
            green→purple→lime gradient underneath. Scoped — globals.css untouched. */}
        <style>{`
          .yj-end-glow { position: relative; }
          .yj-end-glow > a { position: relative; z-index: 1; }
          .yj-end-glow::after {
            content: ''; position: absolute; z-index: 0; pointer-events: none;
            left: 6%; right: 6%; bottom: -3px; height: 72%;
            background: linear-gradient(90deg, var(--grad-green), var(--grad-purple), var(--grad-lime));
            filter: blur(13px); opacity: .6; border-radius: 9999px;
            transition: filter .3s ease, opacity .3s ease, bottom .3s ease;
          }
          .yj-end-glow:hover > a { transform: translateY(-2px); }
          .yj-end-glow:hover::after { filter: blur(17px); opacity: .78; bottom: -5px; }
        `}</style>

        <div className="mx-auto max-w-2xl">
          <h2
            className="mb-4 text-[clamp(28px,4vw,40px)] font-extrabold tracking-tight"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {m.ctaTitle}
          </h2>
          <p className="mb-8 text-lg text-[var(--muted)]">{m.ctaSub}</p>
          <div className="yj-end-glow inline-block">
            <Link
              href={`/${loc}#homepage-composer`}
              className="inline-flex items-center gap-2 rounded-full bg-[var(--fg)] px-8 py-3.5 text-base font-semibold text-white transition-transform"
            >
              {m.ctaButton}
            </Link>
          </div>
          <p className="mt-5 text-xs text-[var(--meta)]">{m.ctaNote}</p>
        </div>
      </section>
    </MarketingChrome>
  );
}
