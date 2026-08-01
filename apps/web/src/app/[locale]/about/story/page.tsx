import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { JsonLd } from '@/components/seo/JsonLd';
import { MarketingChrome } from '@/components/marketing/MarketingChrome';
import { StoryToc } from '@/components/marketing/StoryToc';
import { isLocale, type Locale } from '@/lib/i18n/routing';
import { publicPageMetadata } from '@/lib/seo/metadata';
import { articleSchema, STORY_PUBLISHED } from '@/lib/seo/schema';
import { getMarketingMessages } from '@/messages/marketing';

interface Props {
  params: Promise<{ locale: string }>;
}

/**
 * Stable anchor id for a section heading.
 *
 * Index-based, not slugified from the heading text: one locale's headings are
 * Chinese, so a text slug is a percent-encoded mess in the URL bar, and editing
 * a heading would silently break every link anyone had already shared.
 */
const sectionId = (i: number) => `s${i + 1}`;

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
      {/* One column of text with the contents rail parked in the margin beside
          it. Title, lede and body all share a single left edge — when the rail
          was a sibling of the header instead, the headline lined up with the
          rail and the prose started 240px to its right, so the page had two
          competing left edges. */}
      <article className="mx-auto grid max-w-[46rem] px-6 pb-24 pt-14 md:px-8 lg:max-w-[62rem] lg:grid-cols-[180px_minmax(0,1fr)] lg:gap-x-14">
        <StoryToc
          variant="rail"
          head={m.tocHead}
          items={m.sections.map((section, i) => ({ id: sectionId(i), label: section.h }))}
        />

        <div className="lg:col-start-2">
        <header>
          <h1 className="mb-5 text-[28px] font-bold leading-[1.3] tracking-tight md:text-[38px] md:leading-[1.25]">
            {m.title}
          </h1>

          {/* Author, date, reading time. The human half of the Article JSON-LD:
              a first-person account with nobody's name on it reads as content
              marketing to a person and as thin content to a crawler. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--meta)]">
            <span className="font-medium text-[var(--fg-2)]">{m.byline.author}</span>
            <span aria-hidden>·</span>
            <time dateTime={STORY_PUBLISHED}>{m.byline.date}</time>
            <span aria-hidden>·</span>
            <span>{m.byline.readingTime}</span>
          </div>

          {/* The lede is set larger than the body. It carries the whole premise
              and it is the only part most visitors will actually read. */}
          <div className="mt-9 space-y-4 text-[18px] leading-[1.7] text-[var(--fg-2)] md:text-[19px]">
            {m.lede.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        </header>

        {/* Phones get the same contents, collapsed, and it has to come after the
            title — hence a second instance rather than one that reflows. */}
        <div className="mt-12">
          <StoryToc
            variant="inline"
            head={m.tocHead}
            items={m.sections.map((section, i) => ({ id: sectionId(i), label: section.h }))}
          />

          <div className="space-y-14">
          {m.sections.map((section, i) => (
            // scroll-mt clears the sticky header, or a jumped-to heading lands
            // underneath it.
            <section key={section.h} id={sectionId(i)} className="scroll-mt-24">
              <h2 className="mb-5 text-[21px] font-bold leading-snug tracking-tight text-[var(--fg)] md:text-[25px]">
                {section.h}
              </h2>
              <div className="space-y-[1.15em] text-[17px] leading-[1.9] text-[var(--fg-2)]">
                {section.paras.map((para) => (
                  <p key={para}>{para}</p>
                ))}
                {section.pull ? (
                  <blockquote className="my-8 border-l-[3px] border-[var(--fg)] pl-6 text-[19px] font-medium leading-[1.65] text-[var(--fg)]">
                    {section.pull}
                  </blockquote>
                ) : null}
                {section.bullets ? (
                  <ul className="space-y-2.5 pt-1">
                    {section.bullets.map((item) => (
                      <li key={item} className="flex gap-3">
                        <span
                          aria-hidden
                          className="mt-[0.8em] h-[3px] w-[3px] shrink-0 rounded-full bg-[var(--fg)]"
                        />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </section>
            ))}

            {/* Closing, CTA and disclaimer stay inside the prose column so they
                line up with the text rather than sliding under the rail. */}
            <div>
              <p className="border-t border-[var(--border-soft)] pt-10 text-[18px] leading-[1.8] text-[var(--fg)]">
                {m.closing}
              </p>
              <p className="mt-5 text-sm text-[var(--meta)]">{m.dateline}</p>

              <div className="mt-10">
                <Link
                  href={`/${locale}#homepage-composer`}
                  className="inline-flex h-11 items-center rounded-full bg-[var(--fg)] px-6 text-sm font-medium text-[var(--bg)] transition-opacity hover:opacity-85"
                >
                  {m.ctaLabel}
                </Link>
              </div>

              <p className="mt-14 border-t border-[var(--border-soft)] pt-6 text-[13px] leading-[1.7] text-[var(--meta)]">
                {m.disclaimer}
              </p>
            </div>
          </div>
        </div>
        </div>
      </article>
    </MarketingChrome>
  );
}
