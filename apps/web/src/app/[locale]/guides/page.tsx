import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MarketingChrome } from '@/components/marketing/MarketingChrome';
import { JsonLd } from '@/components/seo/JsonLd';
import {
  GUIDES,
  guideContent,
  guidesHubBreadcrumb,
  guidesItemList,
  resolveGuideLocale,
} from '@/lib/guides/guides';
import { isLocale, type Locale, locales } from '@/lib/i18n/routing';
import { publicPageMetadata } from '@/lib/seo/metadata';
import { getMarketingMessages } from '@/messages/marketing';

interface Props {
  params: Promise<{ locale: string }>;
}

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const m = getMarketingMessages(locale).guides;
  return publicPageMetadata('/guides', locale, m.metaTitle, m.metaDesc);
}

export default async function GuidesHubPage({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const loc = locale as Locale;
  const m = getMarketingMessages(loc).guides;

  return (
    <MarketingChrome locale={loc} pathname="/guides">
      <JsonLd
        data={[guidesHubBreadcrumb(loc, m.breadcrumbHome, m.breadcrumbGuides), guidesItemList(loc)]}
      />
      <div className="mx-auto max-w-[1100px] px-6 pb-24 pt-16 md:px-8">
        <nav aria-label="Breadcrumb" className="mb-6 text-sm text-[var(--meta)]">
          <Link href={`/${locale}`} className="hover:text-[var(--fg)]">
            {m.breadcrumbHome}
          </Link>
          <span className="mx-2">/</span>
          <span className="text-[var(--fg-2)]">{m.breadcrumbGuides}</span>
        </nav>

        <header className="mb-12 max-w-2xl">
          <h1 className="text-4xl font-bold tracking-tight text-[var(--fg)] md:text-5xl">{m.hubTitle}</h1>
          <p className="mt-4 text-lg leading-relaxed text-[var(--muted)]">{m.hubIntro}</p>
        </header>

        <ul className="grid gap-6 sm:grid-cols-2">
          {GUIDES.map((guide) => {
            // An untranslated article is linked at its English URL rather than
            // hidden: a plain cross-language link is not an hreflang claim, so
            // it costs nothing and every locale sees the full library.
            const served = resolveGuideLocale(guide, loc);
            const c = guideContent(guide, served);

            return (
              <li key={guide.slug}>
                <Link
                  href={`/${served}/guides/${guide.slug}`}
                  className="flex h-full flex-col rounded-2xl border border-[var(--line)] p-6 transition hover:border-[var(--fg-2)]"
                >
                  <h2 className="text-xl font-semibold text-[var(--fg)]">{c.title}</h2>
                  <p className="mt-3 flex-1 text-sm leading-relaxed text-[var(--muted)]">{c.excerpt}</p>
                  {served !== loc && <p className="mt-3 text-xs text-[var(--meta)]">{m.englishOnlyNote}</p>}
                  <p className="mt-4 text-sm font-medium text-[var(--fg-2)]">{m.readLabel}</p>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </MarketingChrome>
  );
}
