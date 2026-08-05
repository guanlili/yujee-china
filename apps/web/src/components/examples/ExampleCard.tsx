import Link from 'next/link';
import { type Example, exampleContent } from '@/lib/examples/examples';
import type { Locale } from '@/lib/i18n/routing';

interface Props {
  locale: Locale;
  example: Example;
  openLabel: string;
  /** The first card is the hub's LCP element — load it eagerly, not lazily. */
  priority?: boolean;
}

/** One tile in the /examples hub grid. Static — a real spread still + a link. */
export function ExampleCard({ locale, example, openLabel, priority = false }: Props) {
  const c = exampleContent(example, locale);

  return (
    <Link
      href={`/${locale}/examples/${example.slug}`}
      className="group block overflow-hidden rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] transition-shadow hover:shadow-lg"
    >
      <div className="aspect-[16/9] overflow-hidden bg-[var(--bg)]">
        {/* eslint-disable-next-line @next/next/no-img-element -- marketing surface renders plain <img>, not next/image */}
        <img
          src={example.poster}
          alt={c.galleryAlt[0]}
          width={1280}
          height={720}
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : 'auto'}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
        />
      </div>
      <div className="p-5">
        <h2 className="text-lg font-bold tracking-tight text-[var(--fg)]">{c.title}</h2>
        <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">{c.tagline}</p>
        <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-[var(--accent)]">
          {openLabel}
          <span aria-hidden className="transition-transform group-hover:translate-x-0.5">
            →
          </span>
        </span>
      </div>
    </Link>
  );
}
