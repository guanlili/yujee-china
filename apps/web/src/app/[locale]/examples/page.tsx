import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ExampleCard } from '@/components/examples/ExampleCard';
import { MarketingChrome } from '@/components/marketing/MarketingChrome';
import { JsonLd } from '@/components/seo/JsonLd';
import { EXAMPLES, examplesHubBreadcrumb, examplesItemList } from '@/lib/examples/examples';
import { isLocale, type Locale } from '@/lib/i18n/routing';
import { publicPageMetadata } from '@/lib/seo/metadata';
import { getMarketingMessages } from '@/messages/marketing';

interface Props {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const m = getMarketingMessages(locale).examples;
  return publicPageMetadata('/examples', locale, m.metaTitle, m.metaDesc);
}

export default async function ExamplesPage({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const m = getMarketingMessages(locale as Locale).examples;

  return (
    <MarketingChrome locale={locale as Locale} pathname="/examples">
      <JsonLd
        data={[
          examplesHubBreadcrumb(locale as Locale, m.breadcrumbHome, m.breadcrumbExamples),
          examplesItemList(locale as Locale),
        ]}
      />
      <div className="mx-auto max-w-[1100px] px-6 pb-24 pt-16 md:px-8">
        <nav aria-label="Breadcrumb" className="mb-6 text-sm text-[var(--meta)]">
          <Link href={`/${locale}`} className="hover:text-[var(--fg)]">
            {m.breadcrumbHome}
          </Link>
          <span className="mx-2">/</span>
          <span className="text-[var(--fg-2)]">{m.breadcrumbExamples}</span>
        </nav>

        <header className="mb-12 max-w-2xl">
          <h1 className="text-4xl font-bold tracking-tight text-[var(--fg)] md:text-5xl">{m.hubTitle}</h1>
          <p className="mt-4 text-lg leading-relaxed text-[var(--muted)]">{m.hubIntro}</p>
        </header>

        <div className="grid gap-6 sm:grid-cols-2">
          {EXAMPLES.map((example, i) => (
            <ExampleCard
              key={example.slug}
              locale={locale as Locale}
              example={example}
              openLabel={m.openLabel}
              priority={i === 0}
            />
          ))}
        </div>

        <p className="mt-10 text-sm text-[var(--meta)]">{m.moreComing}</p>
      </div>
    </MarketingChrome>
  );
}
