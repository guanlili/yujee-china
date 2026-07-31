import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { JsonLd } from '@/components/seo/JsonLd';
import { MarketingChrome } from '@/components/marketing/MarketingChrome';
import { isLocale, type Locale } from '@/lib/i18n/routing';
import { publicPageMetadata } from '@/lib/seo/metadata';
import { articleSchema } from '@/lib/seo/schema';
import { getMarketingMessages } from '@/messages/marketing';

interface Props {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const m = getMarketingMessages(locale).story;
  return publicPageMetadata('/about/story', locale, m.metaTitle, m.metaDesc);
}

export default async function StoryPage({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const m = getMarketingMessages(locale as Locale).story;

  return (
    <MarketingChrome locale={locale as Locale} pathname="/about/story">
      <JsonLd data={articleSchema(locale as Locale)} />
      <article className="max-w-2xl mx-auto px-6 md:px-8 pt-16 pb-24">
        <header className="mb-12">
          <h1 className="font-bold text-3xl md:text-4xl tracking-tight leading-[1.25] mb-6">
            {m.title}
          </h1>
          <div className="space-y-3 text-[17px] leading-[1.75] text-[var(--fg-2)]">
            {m.lede.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        </header>

        <div className="space-y-12">
          {m.sections.map((section) => (
            <section key={section.h}>
              <h2 className="text-xl md:text-2xl font-bold tracking-tight mb-4 text-[var(--fg)]">
                {section.h}
              </h2>
              <div className="space-y-4 text-[16px] leading-[1.85] text-[var(--fg-2)]">
                {section.paras.map((para) => (
                  <p key={para}>{para}</p>
                ))}
                {section.pull ? (
                  <blockquote className="my-6 border-l-2 border-[var(--fg)] pl-5 text-[17px] font-medium leading-[1.7] text-[var(--fg)]">
                    {section.pull}
                  </blockquote>
                ) : null}
                {section.bullets ? (
                  <ul className="list-disc space-y-2 pl-5 marker:text-[var(--muted)]">
                    {section.bullets.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </section>
          ))}
        </div>

        <p className="mt-12 text-[16px] leading-[1.85] text-[var(--fg-2)]">{m.closing}</p>
        <p className="mt-6 text-sm text-[var(--muted)]">{m.dateline}</p>

        <div className="mt-12">
          <Link
            href={`/${locale}#homepage-composer`}
            className="inline-flex h-11 items-center rounded-full bg-[var(--fg)] px-6 text-sm font-medium text-[var(--bg)] transition-opacity hover:opacity-85"
          >
            {m.ctaLabel}
          </Link>
        </div>

        <p className="mt-12 border-t border-[var(--border-soft)] pt-6 text-[13px] leading-[1.7] text-[var(--muted)]">
          {m.disclaimer}
        </p>
      </article>
    </MarketingChrome>
  );
}
