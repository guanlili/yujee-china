import { contentFor, type ExampleContent } from '@/lib/examples/content';
import { type Locale, localizePath } from '@/lib/i18n/routing';
import { absoluteUrl } from '@/lib/seo/site';

/**
 * The /examples showcase — one detail page per format Yujee can produce.
 *
 * SINGLE SOURCE OF TRUTH. The routes in the sitemap (see lib/seo/routes.ts), the
 * hub grid, every detail page, and the JSON-LD all derive from this array, so
 * they can never drift. Add a format here and it appears everywhere at once.
 *
 * These are illustrative SAMPLE outputs, not customer testimonials. Every string
 * describes what the product makes; nothing here claims a named person made it.
 * Inventing a customer story would be the same structured-data violation the
 * schema.ts header warns about — don't.
 *
 * Media: each `gallery` frame is a real, settled spread lifted from the product
 * showcase video (`video`). `cardImage` is the decorative brand illustration the
 * homepage already ships. Swap in richer per-format assets as they arrive.
 *
 * The prose lives one file per locale under ./content, keyed by slug — a
 * translator adds a language without touching this structural array.
 */

export type { ExampleContent } from '@/lib/examples/content';

export interface Example {
  slug: string;
  /** Decorative brand illustration (homepage card face). */
  cardImage: string;
  /** Hover/flip-through product video. */
  video: string;
  /** Poster still for the video and the hub card face. */
  poster: string;
  /** Real, settled spreads pulled from the video. */
  gallery: string[];
  /**
   * YYYY-MM-DD. The day this page's visible content last changed — it becomes
   * the sitemap `<lastmod>` for /examples/<slug> (see lib/seo/freshness.ts).
   * Bump it only when a reader would see something different; adding a format
   * sets it to the day the page went live.
   */
  updatedAt: string;
}

export const EXAMPLES: readonly Example[] = [
  {
    slug: 'travel-journal',
    cardImage: '/landing-redesign/cards/01-travel.png',
    video: '/landing-redesign/cards/01-travel.mp4',
    poster: '/examples/travel-journal/spread-01.jpg',
    gallery: [
      '/examples/travel-journal/spread-01.jpg',
      '/examples/travel-journal/spread-02.jpg',
      '/examples/travel-journal/spread-03.jpg',
      '/examples/travel-journal/spread-04.jpg',
    ],
    // 74c590db (2026-09-09) rewrote this page's tagline to carry "AI travel
    // photobook", and the detail page renders the tagline under the H1 — a
    // reader sees different words, so the date moves. The earlier freshness
    // review advanced reviewedAt past that commit without opening it and left
    // this at 08-08; that is the mistake this per-example field exists to stop.
    updatedAt: '2026-09-09',
  },
  {
    slug: 'life-story',
    cardImage: '/landing-redesign/cards/02-life-story.png',
    video: '/landing-redesign/cards/02-life-story.mp4',
    poster: '/examples/life-story/spread-01.jpg',
    gallery: [
      '/examples/life-story/spread-01.jpg',
      '/examples/life-story/spread-02.jpg',
      '/examples/life-story/spread-03.jpg',
      '/examples/life-story/spread-04.jpg',
    ],
    updatedAt: '2026-08-08',
  },
  // The four formats below reuse the homepage card videos the landing already
  // ships. Their spreads are settled frames from those videos (cover, opening
  // spread, two inner spreads) — the same recipe as the two above. NOTE:
  // 05-magazine.mp4 and 06-portfolio.mp4 were rendered from the SAME photo set,
  // so photo-magazine and portfolio-book currently show identical imagery with
  // different chrome. They are placeholders until real finished books replace
  // them; do not treat them as evidence that the formats look alike.
  {
    slug: 'year-in-review',
    cardImage: '/landing-redesign/cards/03-year-record.png',
    video: '/landing-redesign/cards/03-year-record.mp4',
    poster: '/examples/year-in-review/spread-01.jpg',
    gallery: [
      '/examples/year-in-review/spread-01.jpg',
      '/examples/year-in-review/spread-02.jpg',
      '/examples/year-in-review/spread-03.jpg',
      '/examples/year-in-review/spread-04.jpg',
    ],
    updatedAt: '2026-09-21',
  },
  {
    slug: 'growth-story',
    cardImage: '/landing-redesign/cards/04-growth-story.png',
    video: '/landing-redesign/cards/04-growth-story.mp4',
    poster: '/examples/growth-story/spread-01.jpg',
    gallery: [
      '/examples/growth-story/spread-01.jpg',
      '/examples/growth-story/spread-02.jpg',
      '/examples/growth-story/spread-03.jpg',
      '/examples/growth-story/spread-04.jpg',
    ],
    updatedAt: '2026-09-21',
  },
  {
    slug: 'photo-magazine',
    cardImage: '/landing-redesign/cards/05-magazine.png',
    video: '/landing-redesign/cards/05-magazine.mp4',
    poster: '/examples/photo-magazine/spread-01.jpg',
    gallery: [
      '/examples/photo-magazine/spread-01.jpg',
      '/examples/photo-magazine/spread-02.jpg',
      '/examples/photo-magazine/spread-03.jpg',
      '/examples/photo-magazine/spread-04.jpg',
    ],
    updatedAt: '2026-09-21',
  },
  {
    slug: 'portfolio-book',
    cardImage: '/landing-redesign/cards/06-portfolio.png',
    video: '/landing-redesign/cards/06-portfolio.mp4',
    poster: '/examples/portfolio-book/spread-01.jpg',
    gallery: [
      '/examples/portfolio-book/spread-01.jpg',
      '/examples/portfolio-book/spread-02.jpg',
      '/examples/portfolio-book/spread-03.jpg',
      '/examples/portfolio-book/spread-04.jpg',
    ],
    updatedAt: '2026-09-21',
  },
];

export const EXAMPLE_SLUGS: readonly string[] = EXAMPLES.map((e) => e.slug);

export function getExample(slug: string): Example | undefined {
  return EXAMPLES.find((e) => e.slug === slug);
}

export function exampleContent(example: Example, locale: Locale): ExampleContent {
  return contentFor(example.slug, locale);
}

/* ---------- JSON-LD builders (mirror the visible page) ---------- */

interface BreadcrumbItem {
  '@type': 'ListItem';
  position: number;
  name: string;
  item: string;
}

export interface BreadcrumbListSchema {
  '@context': 'https://schema.org';
  '@type': 'BreadcrumbList';
  itemListElement: BreadcrumbItem[];
}

function breadcrumb(trail: { name: string; route: string }[], locale: Locale): BreadcrumbListSchema {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((step, i) => ({
      '@type': 'ListItem' as const,
      position: i + 1,
      name: step.name,
      item: absoluteUrl(localizePath(step.route, locale)),
    })),
  };
}

/** Home → Examples. `examplesLabel` comes from the marketing messages. */
export function examplesHubBreadcrumb(locale: Locale, homeLabel: string, examplesLabel: string) {
  return breadcrumb(
    [
      { name: homeLabel, route: '/' },
      { name: examplesLabel, route: '/examples' },
    ],
    locale,
  );
}

/** Home → Examples → <title>. */
export function exampleBreadcrumb(
  example: Example,
  locale: Locale,
  homeLabel: string,
  examplesLabel: string,
) {
  return breadcrumb(
    [
      { name: homeLabel, route: '/' },
      { name: examplesLabel, route: '/examples' },
      { name: exampleContent(example, locale).title, route: `/examples/${example.slug}` },
    ],
    locale,
  );
}

export interface CreativeWorkSchema {
  '@context': 'https://schema.org';
  '@type': 'CreativeWork';
  name: string;
  description: string;
  url: string;
  image: string[];
  genre: string;
  inLanguage: Locale;
  creator: { '@type': 'Organization'; name: string; url: string };
  isPartOf: { '@type': 'CollectionPage'; name: string; url: string };
}

export function exampleCreativeWork(
  example: Example,
  locale: Locale,
  examplesLabel: string,
): CreativeWorkSchema {
  const c = exampleContent(example, locale);
  return {
    '@context': 'https://schema.org',
    '@type': 'CreativeWork',
    name: c.title,
    description: c.tagline,
    url: absoluteUrl(localizePath(`/examples/${example.slug}`, locale)),
    image: example.gallery.map((src) => absoluteUrl(src)),
    genre: 'Photo book',
    inLanguage: locale,
    creator: { '@type': 'Organization', name: 'Yujee', url: absoluteUrl(localizePath('/', locale)) },
    isPartOf: {
      '@type': 'CollectionPage',
      name: examplesLabel,
      url: absoluteUrl(localizePath('/examples', locale)),
    },
  };
}

export interface ItemListSchema {
  '@context': 'https://schema.org';
  '@type': 'ItemList';
  itemListElement: {
    '@type': 'ListItem';
    position: number;
    url: string;
    name: string;
  }[];
}

export function examplesItemList(locale: Locale): ItemListSchema {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: EXAMPLES.map((example, i) => ({
      '@type': 'ListItem' as const,
      position: i + 1,
      url: absoluteUrl(localizePath(`/examples/${example.slug}`, locale)),
      name: exampleContent(example, locale).title,
    })),
  };
}
