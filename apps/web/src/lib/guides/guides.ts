import { contentFor, type GuideContent } from '@/lib/guides/content';
import { type Locale, localizePath } from '@/lib/i18n/routing';
import { absoluteUrl } from '@/lib/seo/site';

export type { GuideContent, GuideSection } from '@/lib/guides/content';

/**
 * The /guides library — one page per search question Yujee can answer.
 *
 * SINGLE SOURCE OF TRUTH, same contract as lib/examples/examples.ts: the
 * sitemap routes, the hub grid, every detail page and the JSON-LD derive from
 * this array, so they cannot drift.
 *
 * WHY THIS ARRAY CARRIES `availableLocales` AND EXAMPLES DOES NOT
 *
 * Both /examples pages are translated into all five locales, so the site could
 * assume "every route exists in every locale" and emit a five-way hreflang
 * cluster unconditionally. Guides break that assumption on purpose: an article
 * ships in English first and is translated only once it earns the traffic.
 *
 * A missing translation must therefore be ABSENT, not silently English. Serving
 * English prose at /es/guides/<slug> while the sitemap advertises it as the
 * Spanish version is a false hreflang claim, and Google's documented response to
 * a cluster it cannot verify is to discount the whole site's hreflang — taking
 * the landing page and /examples down with it. So the locale list lives here,
 * per article, and lib/seo/routes.ts narrows the cluster to it.
 */
export interface Guide {
  slug: string;
  /**
   * Locales this article has REAL prose in. Never widen a guide's entry until
   * the translation exists in lib/guides/content/<locale>.ts.
   */
  availableLocales: readonly Locale[];
  /** YYYY-MM-DD. First publication, emitted as Article.datePublished. */
  publishedAt: string;
  /** YYYY-MM-DD. Last real content change; feeds both the sitemap and schema. */
  updatedAt: string;
  /**
   * The commit at which a human last confirmed `updatedAt` is still true.
   * Same contract as RouteFreshness.reviewedAt: bump it freely, it never
   * reaches Google. sitemap-freshness-check.ts fails when this article's prose
   * moved after this commit — that is what stops an edited paragraph from
   * shipping with a frozen date.
   */
  reviewedAt: string;
  /**
   * OG / Twitter card and `Article.image`. NEVER rendered on the page — this
   * field's entire job is the social preview, so it must be an OPAQUE image at
   * 1280x720 (the dimensions page.tsx declares). A transparent PNG passes an
   * existence check and still renders as a blank card on any dark background.
   */
  heroImage: string;
  /**
   * Sibling articles, by slug, rendered at the foot of this one.
   *
   * Editorial, not computed: the pairing is "what the same reader opens next",
   * which no similarity score gets right. Two entries is the floor — one link
   * is a dead end rather than a path — and related.test.ts also refuses to let
   * any article go without an INBOUND link, so the seven stay one graph instead
   * of a chain with a tail nobody reaches.
   */
  related: readonly string[];
}

/**
 * Ordered newest-intent-first rather than by date: the hub renders this array in
 * order, and the first two cards are what a first-time visitor reads.
 *
 * The three `faq`-carrying articles are written for GEO — an AI engine quotes a
 * question-and-answer passage, not a page, so those three lead with the answer
 * in every section and ship FAQPage JSON-LD. The narrative how-tos do not, and
 * should not: a fabricated FAQ block on a story-shaped article is padding.
 */
export const GUIDES: readonly Guide[] = [
  {
    slug: 'turn-old-family-photos-into-a-book',
    availableLocales: ['en'],
    publishedAt: '2026-08-16',
    updatedAt: '2026-08-16',
    reviewedAt: '83b929f6',
    heroImage: '/examples/life-story/spread-01.jpg',
    related: [
      'write-a-memoir-about-a-parent',
      'what-to-write-in-a-photo-book',
      'photo-book-vs-photo-album-vs-scrapbook',
    ],
  },
  {
    slug: 'make-a-photo-book-from-iphone-photos',
    availableLocales: ['en'],
    publishedAt: '2026-08-16',
    updatedAt: '2026-08-17',
    reviewedAt: '83b929f6',
    heroImage: '/examples/travel-journal/spread-03.jpg',
    related: [
      'what-to-write-in-a-photo-book',
      'how-much-does-a-photo-book-cost',
      'how-to-choose-an-ai-photo-book-maker',
    ],
  },
  {
    slug: 'what-to-write-in-a-photo-book',
    availableLocales: ['en'],
    publishedAt: '2026-08-16',
    updatedAt: '2026-08-17',
    reviewedAt: '83b929f6',
    heroImage: '/examples/life-story/spread-02.jpg',
    related: [
      'write-a-memoir-about-a-parent',
      'turn-old-family-photos-into-a-book',
      'make-a-photo-book-from-iphone-photos',
    ],
  },
  {
    slug: 'write-a-memoir-about-a-parent',
    availableLocales: ['en'],
    publishedAt: '2026-08-16',
    updatedAt: '2026-08-17',
    reviewedAt: '83b929f6',
    heroImage: '/examples/life-story/spread-03.jpg',
    related: [
      'turn-old-family-photos-into-a-book',
      'what-to-write-in-a-photo-book',
    ],
  },
  {
    slug: 'photo-book-vs-photo-album-vs-scrapbook',
    availableLocales: ['en'],
    publishedAt: '2026-08-16',
    updatedAt: '2026-08-16',
    reviewedAt: '83b929f6',
    heroImage: '/examples/travel-journal/spread-01.jpg',
    related: [
      'how-much-does-a-photo-book-cost',
      'turn-old-family-photos-into-a-book',
      'how-to-choose-an-ai-photo-book-maker',
    ],
  },
  {
    slug: 'how-much-does-a-photo-book-cost',
    availableLocales: ['en'],
    publishedAt: '2026-08-16',
    updatedAt: '2026-08-17',
    reviewedAt: '83b929f6',
    heroImage: '/examples/travel-journal/spread-02.jpg',
    related: [
      'photo-book-vs-photo-album-vs-scrapbook',
      'how-to-choose-an-ai-photo-book-maker',
    ],
  },
  {
    slug: 'how-to-choose-an-ai-photo-book-maker',
    availableLocales: ['en'],
    publishedAt: '2026-08-16',
    updatedAt: '2026-08-17',
    reviewedAt: '83b929f6',
    heroImage: '/examples/life-story/spread-04.jpg',
    related: [
      'how-much-does-a-photo-book-cost',
      'make-a-photo-book-from-iphone-photos',
      'photo-book-vs-photo-album-vs-scrapbook',
    ],
  },
];

export const GUIDE_SLUGS: readonly string[] = GUIDES.map((g) => g.slug);

export function getGuide(slug: string): Guide | undefined {
  return GUIDES.find((g) => g.slug === slug);
}

/**
 * The sibling articles to render at the foot of `guide`, in editorial order.
 *
 * A slug with no article behind it is DROPPED rather than thrown on: this runs
 * inside a page render, and a mistyped slug should cost one link, not the whole
 * article. related.test.ts is what catches the typo, at build time, where it is
 * still cheap.
 */
export function relatedGuides(guide: Guide): readonly Guide[] {
  return guide.related
    .filter((slug) => slug !== guide.slug)
    .map((slug) => getGuide(slug))
    .filter((g): g is Guide => g !== undefined);
}

/** Throws if the locale is not in the guide's `availableLocales` — check first. */
export function guideContent(guide: Guide, locale: Locale): GuideContent {
  return contentFor(guide.slug, locale);
}

/** The locale to actually serve: the requested one, or English if untranslated. */
export function resolveGuideLocale(guide: Guide, locale: Locale): Locale {
  return guide.availableLocales.includes(locale) ? locale : 'en';
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

/** Home → Guides. */
export function guidesHubBreadcrumb(locale: Locale, homeLabel: string, guidesLabel: string) {
  return breadcrumb(
    [
      { name: homeLabel, route: '/' },
      { name: guidesLabel, route: '/guides' },
    ],
    locale,
  );
}

/** Home → Guides → <title>. The last crumb is the visible H1, not the metaTitle. */
export function guideBreadcrumb(
  guide: Guide,
  locale: Locale,
  homeLabel: string,
  guidesLabel: string,
) {
  return breadcrumb(
    [
      { name: homeLabel, route: '/' },
      { name: guidesLabel, route: '/guides' },
      { name: guideContent(guide, locale).title, route: `/guides/${guide.slug}` },
    ],
    locale,
  );
}

export interface GuideArticleSchema {
  '@context': 'https://schema.org';
  '@type': 'Article';
  headline: string;
  description: string;
  url: string;
  image: string[];
  inLanguage: Locale;
  datePublished: string;
  dateModified: string;
  author: { '@type': 'Organization'; name: string; url: string };
  publisher: { '@type': 'Organization'; name: string; logo: string };
  isPartOf: { '@type': 'CollectionPage'; name: string; url: string };
}

/**
 * `author` is the Organization, not a Person.
 *
 * The story page names a real author because a founder story genuinely has one.
 * These are product documentation written by the company, and inventing a
 * byline to look more E-E-A-T compliant is the same fabrication the examples
 * file warns about — a named author who does not exist is worse than none.
 */
export function guideArticleSchema(guide: Guide, locale: Locale): GuideArticleSchema {
  const c = guideContent(guide, locale);
  const home = absoluteUrl(localizePath('/', locale));

  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: c.title,
    description: c.metaDesc,
    url: absoluteUrl(localizePath(`/guides/${guide.slug}`, locale)),
    image: [absoluteUrl(guide.heroImage)],
    inLanguage: locale,
    datePublished: guide.publishedAt,
    dateModified: guide.updatedAt,
    author: { '@type': 'Organization', name: 'Yujee', url: home },
    publisher: { '@type': 'Organization', name: 'Yujee', logo: absoluteUrl('/icon.png') },
    isPartOf: {
      '@type': 'CollectionPage',
      name: 'Guides',
      url: absoluteUrl(localizePath('/guides', locale)),
    },
  };
}

export interface GuideFaqSchema {
  '@context': 'https://schema.org';
  '@type': 'FAQPage';
  mainEntity: {
    '@type': 'Question';
    name: string;
    acceptedAnswer: { '@type': 'Answer'; text: string };
  }[];
}

/**
 * FAQPage JSON-LD for articles that carry an faq block, `undefined` for those
 * that do not.
 *
 * Mirrors the visible block verbatim — see GuideContent.faq for why the two may
 * never diverge. Returning undefined rather than an empty FAQPage matters: an
 * FAQPage with no questions is a malformed entity, not an empty one.
 */
export function guideFaqSchema(guide: Guide, locale: Locale): GuideFaqSchema | undefined {
  const faq = guideContent(guide, locale).faq;
  if (!faq?.length) return undefined;

  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faq.map((entry) => ({
      '@type': 'Question' as const,
      name: entry.q,
      acceptedAnswer: { '@type': 'Answer' as const, text: entry.a },
    })),
  };
}

export interface GuidesItemListSchema {
  '@context': 'https://schema.org';
  '@type': 'ItemList';
  itemListElement: {
    '@type': 'ListItem';
    position: number;
    url: string;
    name: string;
  }[];
}

/**
 * The hub lists every article in every locale — an untranslated one is linked at
 * its English URL rather than dropped, so no language sees a shorter library.
 * That link is a genuine cross-language link, not an hreflang claim, so it costs
 * nothing.
 */
export function guidesItemList(locale: Locale): GuidesItemListSchema {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: GUIDES.map((guide, i) => {
      const served = resolveGuideLocale(guide, locale);
      return {
        '@type': 'ListItem' as const,
        position: i + 1,
        url: absoluteUrl(localizePath(`/guides/${guide.slug}`, served)),
        name: guideContent(guide, served).title,
      };
    }),
  };
}
