import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { MarketingChrome } from '@/components/marketing/MarketingChrome';
import { JsonLd } from '@/components/seo/JsonLd';
import {
  GUIDES,
  getGuide,
  guideArticleSchema,
  guideBreadcrumb,
  guideContent,
  guideFaqSchema,
  relatedGuides,
  resolveGuideLocale,
} from '@/lib/guides/guides';
import { isLocale, type Locale } from '@/lib/i18n/routing';
import { publicPageMetadata } from '@/lib/seo/metadata';
import { absoluteUrl } from '@/lib/seo/site';
import { getMarketingMessages } from '@/messages/marketing';

interface Props {
  params: Promise<{ locale: string; slug: string }>;
}

/**
 * Only the (locale, slug) pairs that have real prose behind them are
 * pre-rendered. A request for an untranslated pair still resolves — Next renders
 * it on demand and the component below redirects — but it never becomes a build
 * artifact claiming to be that language.
 */
export function generateStaticParams() {
  return GUIDES.flatMap((guide) =>
    guide.availableLocales.map((locale) => ({ locale, slug: guide.slug })),
  );
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) return {};
  const guide = getGuide(slug);
  // No metadata for a locale we are about to redirect out of: emitting a
  // canonical for a URL that 307s would advertise the redirect as a real page.
  if (!guide?.availableLocales.includes(locale)) return {};

  const c = guideContent(guide, locale);
  return publicPageMetadata(`/guides/${slug}`, locale, c.metaTitle, c.metaDesc, {
    url: absoluteUrl(guide.heroImage),
    width: 1280,
    height: 720,
    alt: c.title,
  });
}

export default async function GuideDetailPage({ params }: Props) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const guide = getGuide(slug);
  if (!guide) notFound();

  // TEMPORARY (307), not permanent. The Spanish version does not exist YET; a
  // 308 would tell Google this URL moved for good, and it would have to be
  // un-learned the day the translation ships. Serving the English prose here
  // under a Spanish URL was the other option, and it is the one that gets the
  // whole site's hreflang discounted.
  if (!guide.availableLocales.includes(locale)) redirect(`/en/guides/${slug}`);

  const loc = locale as Locale;
  const m = getMarketingMessages(loc).guides;
  const c = guideContent(guide, loc);
  const siblings = relatedGuides(guide);

  return (
    <MarketingChrome locale={loc} pathname={`/guides/${slug}`}>
      <JsonLd
        data={[
          guideBreadcrumb(guide, loc, m.breadcrumbHome, m.breadcrumbGuides),
          guideArticleSchema(guide, loc),
          // undefined for narrative articles; JsonLd drops it.
          guideFaqSchema(guide, loc),
        ].filter((s) => s !== undefined)}
      />
      <article className="mx-auto max-w-[720px] px-6 pb-24 pt-16 md:px-8">
        <nav aria-label="Breadcrumb" className="mb-6 text-sm text-[var(--meta)]">
          <Link href={`/${locale}`} className="hover:text-[var(--fg)]">
            {m.breadcrumbHome}
          </Link>
          <span className="mx-2">/</span>
          <Link href={`/${locale}/guides`} className="hover:text-[var(--fg)]">
            {m.breadcrumbGuides}
          </Link>
        </nav>

        <header className="mb-10">
          <h1 className="text-4xl font-bold leading-tight tracking-tight text-[var(--fg)] md:text-5xl">
            {c.title}
          </h1>
          <p className="mt-3 text-sm text-[var(--meta)]">
            {m.updatedLabel} {guide.updatedAt}
          </p>
          <p className="mt-6 text-lg leading-relaxed text-[var(--muted)]">{c.lede}</p>
        </header>

        {c.sections.map((section) => (
          <section key={section.h} className="mb-10">
            <h2 className="mb-4 text-2xl font-semibold text-[var(--fg)]">{section.h}</h2>
            {section.paras.map((para) => (
              <p key={para} className="mb-4 leading-relaxed text-[var(--muted)]">
                {para}
              </p>
            ))}
          </section>
        ))}

        {/*
          Rendered from the same `c.faq` the FAQPage JSON-LD is built from, and
          rendered VISIBLY. Markup describing an answer a human cannot read on
          the page is a structured-data violation, and the point of the block is
          that the reader and the crawler get the same answer.
        */}
        {c.faq?.length ? (
          <section className="mt-16 border-t border-[var(--line)] pt-10">
            <h2 className="mb-6 text-2xl font-semibold text-[var(--fg)]">{m.faqHead}</h2>
            <dl>
              {c.faq.map((entry) => (
                <div key={entry.q} className="mb-6">
                  <dt className="mb-2 font-semibold text-[var(--fg)]">{entry.q}</dt>
                  <dd className="leading-relaxed text-[var(--muted)]">{entry.a}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

        {/*
          Sibling links, ABOVE the CTA rather than below it. A reader who is not
          ready to upload is the one who needs somewhere else to go, and a block
          under the sign-up card is a block they have already scrolled past.

          Each sibling is linked at the locale it actually has prose in, exactly
          as the hub does it: a cross-language <a> is not an hreflang claim, so
          it costs nothing, while a link to an untranslated URL would just bounce
          the reader through the 307.
        */}
        {siblings.length ? (
          <nav aria-labelledby="related-head" className="mt-16 border-t border-[var(--line)] pt-10">
            <h2 id="related-head" className="mb-6 text-2xl font-semibold text-[var(--fg)]">
              {m.relatedHead}
            </h2>
            <ul className="grid gap-4 sm:grid-cols-2">
              {siblings.map((sibling) => {
                const served = resolveGuideLocale(sibling, loc);
                const sc = guideContent(sibling, served);

                return (
                  <li key={sibling.slug}>
                    <Link
                      href={`/${served}/guides/${sibling.slug}`}
                      className="flex h-full flex-col rounded-2xl border border-[var(--line)] p-5 transition hover:border-[var(--fg-2)]"
                    >
                      <h3 className="font-semibold leading-snug text-[var(--fg)]">{sc.title}</h3>
                      <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">{sc.excerpt}</p>
                      {/* Same warning the hub gives, for the same reason: the card
                          is in the reader's language and the article behind it is
                          not. Silent is worse than a click they did not want. */}
                      {served !== loc && (
                        <p className="mt-3 text-xs text-[var(--meta)]">{m.englishOnlyNote}</p>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        ) : null}

        <aside className="mt-16 rounded-2xl border border-[var(--line)] p-8">
          <h2 className="text-xl font-semibold text-[var(--fg)]">{m.ctaHead}</h2>
          <p className="mt-3 leading-relaxed text-[var(--muted)]">{m.ctaBody}</p>
          <Link
            href={`/${locale}#homepage-composer`}
            className="mt-6 inline-block rounded-full bg-[var(--fg)] px-6 py-3 text-sm font-medium text-[var(--bg)]"
          >
            {m.ctaButton}
          </Link>
        </aside>
      </article>
    </MarketingChrome>
  );
}
