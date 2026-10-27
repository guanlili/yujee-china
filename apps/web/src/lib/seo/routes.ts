import { EXAMPLE_SLUGS } from '@/lib/examples/examples';
import { getGuide, GUIDE_SLUGS } from '@/lib/guides/guides';
import { defaultLocale, type Locale, locales } from '@/lib/i18n/routing';

/** /examples plus one detail route per example, derived so they can't drift. */
const EXAMPLE_ROUTES: readonly string[] = [
  '/examples',
  ...EXAMPLE_SLUGS.map((slug) => `/examples/${slug}`),
];

const GUIDES_BASE = '/guides';

/** The guides hub plus one detail route per article, derived the same way. */
const GUIDE_ROUTES: readonly string[] = [
  GUIDES_BASE,
  ...GUIDE_SLUGS.map((slug) => `${GUIDES_BASE}/${slug}`),
];

/**
 * The locales one route genuinely exists in — the hreflang cluster and the
 * sitemap rows for that route are both built from this, never from `locales`.
 *
 * Everything outside /guides is translated into all five, so the default is the
 * full set and the marketing pages are unaffected.
 */
export function localesForRoute(route: string): readonly Locale[] {
  const slug = route.startsWith(`${GUIDES_BASE}/`) ? route.slice(GUIDES_BASE.length + 1) : undefined;
  // Fails CLOSED. Unreachable today (GUIDE_ROUTES derives from GUIDES, so every
  // /guides/<slug> route has an article), but the whole job of this function is
  // to avoid claiming languages that do not exist — so an unknown article must
  // collapse to the locale it can actually serve, never fan out to all five.
  return slug ? (getGuide(slug)?.availableLocales ?? [defaultLocale]) : locales;
}

/**
 * The locale whose URL hreflang x-default points at. The site default when the
 * route exists in it; otherwise the locale the route itself serves when asked
 * for one it lacks — the same fallback `resolveGuideLocale` applies to a reader.
 *
 * x-default must never name a URL outside the route's cluster (not in the
 * sitemap, 307s on fetch): Google reads the sitemap, the <head> tags and any
 * Link header as one cluster and discounts hreflang sitewide when they
 * disagree. With a zh site default and English-only guides, pointing x-default
 * at /zh/guides/<slug> would do exactly that.
 */
export function xDefaultLocaleForRoute(route: string): Locale {
  const available = localesForRoute(route);
  return available.includes(defaultLocale) ? defaultLocale : available[0];
}

/**
 * The locale-relative routes that belong in the sitemap.
 *
 * Everything else is deliberately absent:
 *   - /login, /register, /forgot-password, /reset-password — crawlable (so the
 *     crawler can read it) but emit a `noindex` meta from their own page. Never
 *     add them here.
 *   - /my-albums, /credits, /settings, /admin — middleware 307s anonymous
 *     requests to /login, so a crawler can never reach them.
 */
export const INDEXABLE_ROUTES: readonly string[] = [
  '/',
  '/about/story',
  // Back in the sitemap after living as a 308 onto the home anchor. The Terms
  // point at "the pricing page" by name, and the buying questions it answers
  // have no home on the landing page.
  '/pricing',
  '/privacy',
  '/terms',
  ...EXAMPLE_ROUTES,
  ...GUIDE_ROUTES,
];

/**
 * Routes whose pages must emit `robots: NOINDEX`. Not consumed by robots.txt on
 * purpose — a Disallow would stop the crawler from ever fetching the page and
 * seeing that meta tag. This list exists so the test below can assert the two
 * sets never overlap.
 */
export const NOINDEX_ROUTES: readonly string[] = [
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
];

/** Pages that change often enough to be worth re-crawling frequently. */
export const CHANGE_FREQUENCY: Record<string, 'weekly' | 'monthly' | 'yearly'> = {
  '/': 'weekly',
  // A founder story is written once. Claiming it changes weekly teaches Google
  // to ignore the signal on the pages where it is true.
  '/about/story': 'yearly',
  // Prices move, but on the order of a repricing, not a news cycle.
  '/pricing': 'monthly',
  '/privacy': 'yearly',
  '/terms': 'yearly',
  ...Object.fromEntries(EXAMPLE_ROUTES.map((route) => [route, 'monthly' as const])),
};

export const ROUTE_PRIORITY: Record<string, number> = {
  '/': 1,
  // Below the landing page, well above the legal pages: it is the only page
  // carrying original first-person content, which is what earns rankings.
  '/about/story': 0.7,
  // The money page. Second only to the landing page.
  '/pricing': 0.8,
  '/privacy': 0.3,
  '/terms': 0.3,
  '/examples': 0.7,
  ...Object.fromEntries(EXAMPLE_SLUGS.map((slug) => [`/examples/${slug}`, 0.6])),
};
