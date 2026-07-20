import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MarketingChrome } from '@/components/marketing/MarketingChrome';
import { JsonLd } from '@/components/seo/JsonLd';
import {
  EXAMPLES,
  exampleBreadcrumb,
  exampleContent,
  exampleCreativeWork,
  getExample,
} from '@/lib/examples/examples';
import { isLocale, type Locale, locales } from '@/lib/i18n/routing';
import { publicPageMetadata } from '@/lib/seo/metadata';
import { absoluteUrl } from '@/lib/seo/site';
import { getMarketingMessages } from '@/messages/marketing';

interface Props {
  params: Promise<{ locale: string; slug: string }>;
}

export function generateStaticParams() {
  return locales.flatMap((locale) => EXAMPLES.map((example) => ({ locale, slug: example.slug })));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) return {};
  const example = getExample(slug);
  if (!example) return {};
  const c = exampleContent(example, locale);
  // Use this example's own cover spread as the social preview, not the generic
  // site OG card — the whole point of a showcase page is its visual.
  return publicPageMetadata(`/examples/${slug}`, locale, c.metaTitle, c.metaDesc, {
    url: absoluteUrl(example.poster),
    width: 1280,
    height: 720,
    alt: c.galleryAlt[0],
  });
}

export default async function ExampleDetailPage({ params }: Props) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const example = getExample(slug);
  if (!example) notFound();

  const loc = locale as Locale;
  const m = getMarketingMessages(loc).examples;
  const c = exampleContent(example, loc);
  const composerHref = `/${locale}#homepage-composer`;

  return (
    <MarketingChrome locale={loc} pathname={`/examples/${slug}`}>
      <JsonLd
        data={[
          exampleBreadcrumb(example, loc, m.breadcrumbHome, m.breadcrumbExamples),
          exampleCreativeWork(example, loc, m.breadcrumbExamples),
        ]}
      />
      <article className="mx-auto max-w-[900px] px-6 pb-24 pt-16 md:px-8">
        <nav aria-label="Breadcrumb" className="mb-6 text-sm text-[var(--meta)]">
          <Link href={`/${locale}`} className="hover:text-[var(--fg)]">
            {m.breadcrumbHome}
          </Link>
          <span className="mx-2">/</span>
          <Link href={`/${locale}/examples`} className="hover:text-[var(--fg)]">
            {m.breadcrumbExamples}
          </Link>
          <span className="mx-2">/</span>
          <span className="text-[var(--fg-2)]">{c.title}</span>
        </nav>

        <header className="mb-8">
          <p className="text-sm font-semibold uppercase tracking-wide text-[var(--accent)]">{m.kicker}</p>
          <h1 className="mt-2 text-4xl font-bold tracking-tight text-[var(--fg)] md:text-5xl">{c.title}</h1>
          <p className="mt-3 text-lg text-[var(--muted)]">{c.tagline}</p>
        </header>

        <figure className="mb-10 overflow-hidden rounded-2xl border border-[var(--border-soft)] bg-[var(--bg)]">
          <video
            controls
            preload="none"
            poster={example.poster}
            src={example.video}
            width={1280}
            height={720}
            className="h-auto w-full"
            aria-label={`${m.flipThrough} — ${c.title}`}
          />
        </figure>

        <div className="space-y-5 text-[15px] leading-[1.8] text-[var(--fg-2)]">
          {c.intro.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>

        <section className="mt-12">
          <h2 className="mb-5 text-xl font-bold tracking-tight text-[var(--fg)]">{m.galleryHead}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {example.gallery.map((src, i) => (
              // eslint-disable-next-line @next/next/no-img-element -- marketing surface renders plain <img>, not next/image
              <img
                key={src}
                src={src}
                alt={c.galleryAlt[i]}
                width={1280}
                height={720}
                loading="lazy"
                className="w-full rounded-xl border border-[var(--border-soft)]"
              />
            ))}
          </div>
        </section>

        <div className="mt-12 grid gap-10 sm:grid-cols-2">
          <section>
            <h2 className="mb-4 text-lg font-bold tracking-tight text-[var(--fg)]">{m.insideHead}</h2>
            <ul className="space-y-2 text-[15px] leading-relaxed text-[var(--fg-2)]">
              {c.inside.map((item, i) => (
                <li key={`${i}-${item}`} className="flex gap-2">
                  <span aria-hidden className="text-[var(--accent)]">
                    ·
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h2 className="mb-4 text-lg font-bold tracking-tight text-[var(--fg)]">{m.madeWithHead}</h2>
            <ul className="flex flex-wrap gap-2">
              {c.madeWith.map((item, i) => (
                <li
                  key={`${i}-${item}`}
                  className="rounded-full border border-[var(--border-soft)] bg-[var(--surface)] px-3 py-1 text-sm text-[var(--fg-2)]"
                >
                  {item}
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className="mt-14 flex flex-wrap items-center gap-4 border-t border-[var(--border-soft)] pt-10">
          <Link
            href={composerHref}
            className="rounded-full bg-[var(--fg)] px-6 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            {m.makeSame}
          </Link>
          <Link
            href={`/${locale}/examples`}
            className="text-sm font-medium text-[var(--muted)] hover:text-[var(--fg)]"
          >
            ← {m.breadcrumbExamples}
          </Link>
        </div>
      </article>
    </MarketingChrome>
  );
}
