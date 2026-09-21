import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MarketingChrome } from '@/components/marketing/MarketingChrome';
import { JsonLd } from '@/components/seo/JsonLd';
import {
  ADDON_PACKS,
  FREE_PLAN_CREDITS,
  MAX_PHOTOS_PER_GENERATION,
  PAGES_PER_CREDIT_LABEL,
  PHOTOS_PER_CREDIT,
} from '@/config/pricing';
import { getGuide, resolveGuideLocale } from '@/lib/guides/guides';
import { isLocale, type Locale, locales } from '@/lib/i18n/routing';
import { publicPageMetadata } from '@/lib/seo/metadata';
import { pricingBreadcrumb, pricingAppJsonLd } from '@/lib/seo/schema';
import { getMarketingMessages } from '@/messages/marketing';

interface Props {
  params: Promise<{ locale: string }>;
}

/**
 * The standalone pricing page.
 *
 * It used to 308 onto the home page's #pricing anchor, and the comment on that
 * redirect made a fair case: a second copy of the same three price cards is a
 * thin duplicate of the landing page, and Google treats it as one.
 *
 * What changed is the page, not the argument. The cards are the smallest part
 * of it now; the rest is the material the home anchor has no room for — what a
 * real book costs in credits, what happens when a generation fails, that the
 * price does not include printing, and the refund position. Section 7 of the
 * Terms already points readers at "the pricing page" by name, and "yujee
 * pricing" had no URL to rank. None of that is duplicated from the landing page.
 *
 * THE RULE FOR EDITING THIS PAGE: no number is ever typed here. Every figure is
 * interpolated from config/pricing.ts, because the failure that matters is the
 * silent one — billing charges the new price while the marketing page quotes
 * the old one, and each looks correct on its own. pricing-page.test.ts fails on
 * a hardcoded price.
 */

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

const usd = (amount: number) => `$${amount}`;
// Per-photo rate under each pack. 20 credits for $3 is $0.15 and 200 for $20 is
// $0.10 — the old parseFloat(toFixed(3)) rendered the latter as "$0.1", which
// reads like a typo on the one page whose whole job is stating prices.
const perPhoto = (amount: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 3,
  }).format(amount);

/**
 * Copy refers to three price points by role, not by index. Deriving them by
 * POSITION rather than destructuring three names means the page still renders
 * if the pack line-up is ever cut to two or extended to four — the earlier
 * version destructured `[SMALL, MID, LARGE]` and threw on a two-pack config,
 * which is a 500 on the money page in all five locales.
 */
const PACKS_BY_PRICE = [...ADDON_PACKS].sort((a, b) => a.priceUsd - b.priceUsd);

function packPrice(role: 'small' | 'mid' | 'large'): string {
  if (PACKS_BY_PRICE.length === 0) return '';
  const index = {
    small: 0,
    mid: Math.floor((PACKS_BY_PRICE.length - 1) / 2),
    large: PACKS_BY_PRICE.length - 1,
  }[role];
  return usd(PACKS_BY_PRICE[index]!.priceUsd);
}

/** The printing-cost guide this page hands off to. */
const COST_GUIDE_SLUG = 'how-much-does-a-photo-book-cost';

/**
 * Copy tokens → config values. Same contract as the landing page's
 * `withPhotoRule`: the message files state the rule, never the number, so a
 * repricing cannot leave stale figures in five translations.
 */
function fill(copy: string): string {
  return copy
    .replaceAll('{credits}', String(FREE_PLAN_CREDITS))
    .replaceAll('{photos}', String(PHOTOS_PER_CREDIT))
    .replaceAll('{max}', String(MAX_PHOTOS_PER_GENERATION))
    .replaceAll('{pages}', PAGES_PER_CREDIT_LABEL)
    .replaceAll('{packSmall}', packPrice('small'))
    .replaceAll('{packMid}', packPrice('mid'))
    .replaceAll('{packLarge}', packPrice('large'));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const m = getMarketingMessages(locale).pricingPage;
  return publicPageMetadata('/pricing', locale, m.metaTitle, m.metaDesc);
}

export default async function PricingPage({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const loc = locale as Locale;
  const m = getMarketingMessages(loc).pricingPage;
  const nav = getMarketingMessages(loc).guides;
  // Linked at the locale the article actually has prose in, not at `loc`:
  // the guides are English-first, and a link into an untranslated URL would
  // just bounce the reader through that route's 307.
  const costGuide = getGuide(COST_GUIDE_SLUG);
  const costGuideLocale = costGuide ? resolveGuideLocale(costGuide, loc) : 'en';

  return (
    <MarketingChrome locale={loc} pathname="/pricing">
      <JsonLd
        data={[
          pricingBreadcrumb(loc, nav.breadcrumbHome, m.title),
          pricingAppJsonLd(loc, m.packsCreditsLabel),
        ]}
      />
      <div className="mx-auto max-w-[720px] px-6 pb-24 pt-16 md:px-8">
        <header className="mb-12">
          <h1 className="text-4xl font-bold leading-tight tracking-tight text-[var(--fg)] md:text-5xl">
            {m.title}
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-[var(--muted)]">{fill(m.lede)}</p>
          <p className="mt-3 text-lg leading-relaxed text-[var(--fg-2)]">{fill(m.freeLine)}</p>
        </header>

        <section className="mb-14">
          <h2 className="mb-6 text-2xl font-semibold text-[var(--fg)]">{m.packsHead}</h2>
          <ul className="grid gap-4 sm:grid-cols-3">
            {ADDON_PACKS.map((pack) => (
              <li
                key={pack.id}
                className="rounded-2xl border border-[var(--line)] p-5 text-center"
              >
                <div className="text-3xl font-extrabold tracking-tight text-[var(--fg)]">
                  {usd(pack.priceUsd)}
                </div>
                <div className="mt-2 text-sm text-[var(--fg-2)]">
                  {pack.books.toLocaleString(loc)} {m.packsCreditsLabel}
                </div>
                <div className="mt-1 text-xs text-[var(--meta)]">
                  {perPhoto(pack.priceUsd / pack.books)} {m.packsPerPhoto}
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="mb-14">
          <h2 className="mb-6 text-2xl font-semibold text-[var(--fg)]">{m.workedHead}</h2>
          <dl>
            {m.worked.map((entry) => (
              <div key={entry.h} className="mb-5">
                <dt className="mb-1 font-semibold text-[var(--fg)]">{entry.h}</dt>
                <dd className="leading-relaxed text-[var(--muted)]">{fill(entry.body)}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-6 leading-relaxed text-[var(--muted)]">{fill(m.capLine)}</p>
        </section>

        <section className="mb-14">
          <h2 className="mb-6 text-2xl font-semibold text-[var(--fg)]">{m.includedHead}</h2>
          <ul>
            {m.included.map((item) => (
              <li key={item} className="mb-3 flex gap-3 leading-relaxed text-[var(--muted)]">
                <span aria-hidden className="text-[var(--fg-2)]">
                  ·
                </span>
                <span>{fill(item)}</span>
              </li>
            ))}
          </ul>
        </section>

        {/*
          The section that earns this page its URL. Every competitor in the
          SERP ships a printed object; Yujee sells the file. Saying so plainly
          is both the honest answer to "why is this $3 when Shutterfly is $40"
          and the internal link into the printing-cost guide.
        */}
        <section className="mb-14">
          <h2 className="mb-6 text-2xl font-semibold text-[var(--fg)]">{m.notIncludedHead}</h2>
          <p className="leading-relaxed text-[var(--muted)]">{fill(m.notIncludedBody)}</p>
          <Link
            href={`/${costGuideLocale}/guides/${COST_GUIDE_SLUG}`}
            className="mt-3 inline-block font-medium text-[var(--fg-2)] underline underline-offset-4"
          >
            {m.notIncludedLink}
          </Link>
        </section>

        <section className="mb-14">
          <h2 className="mb-4 text-2xl font-semibold text-[var(--fg)]">{m.failureHead}</h2>
          <p className="leading-relaxed text-[var(--muted)]">{fill(m.failureBody)}</p>
        </section>

        <section className="mb-14">
          <h2 className="mb-4 text-2xl font-semibold text-[var(--fg)]">{m.noExpiryHead}</h2>
          <p className="leading-relaxed text-[var(--muted)]">{fill(m.noExpiryBody)}</p>
        </section>

        {/*
          Worded to match Terms §7 rather than restated from scratch. A blunter
          "no refunds, ever" on the marketing page would contradict our own
          Terms, which carve out what the law does not let us exclude and defer
          to the payment provider's rules. Two of our own documents disagreeing
          is worse than either wording alone.
        */}
        <section className="mb-14">
          <h2 className="mb-4 text-2xl font-semibold text-[var(--fg)]">{m.refundHead}</h2>
          <p className="leading-relaxed text-[var(--muted)]">{fill(m.refundBody)}</p>
        </section>

        <section className="mb-14">
          <h2 className="mb-6 text-2xl font-semibold text-[var(--fg)]">{m.faqHead}</h2>
          <dl>
            {m.faq.map((entry) => (
              <div key={entry.q} className="mb-6">
                <dt className="mb-2 font-semibold text-[var(--fg)]">{entry.q}</dt>
                <dd className="leading-relaxed text-[var(--muted)]">{fill(entry.a)}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/*
          TWO destinations, on purpose. The primary button goes to the composer
          because the copy above it sells the free credits — the reader has not
          decided to pay yet. The secondary link is the only buy path on this
          page: checkout buttons live in the home #pricing block (that is where
          the Waffo call sits) and repointing the footer at /pricing removed the
          other route to them. A money page with no way to pay was the bug.
        */}
        <aside className="rounded-2xl border border-[var(--line)] p-8">
          <h2 className="text-xl font-semibold text-[var(--fg)]">{m.ctaHead}</h2>
          <p className="mt-3 leading-relaxed text-[var(--muted)]">{fill(m.ctaBody)}</p>
          <div className="mt-6 flex flex-wrap items-center gap-4">
            <Link
              href={`/${locale}#homepage-composer`}
              className="inline-block rounded-full bg-[var(--fg)] px-6 py-3 text-sm font-medium text-[var(--bg)]"
            >
              {m.ctaButton}
            </Link>
            <Link
              href={`/${locale}#pricing`}
              className="text-sm font-medium text-[var(--fg-2)] underline underline-offset-4"
            >
              {m.buyLink}
            </Link>
          </div>
        </aside>
      </div>
    </MarketingChrome>
  );
}
