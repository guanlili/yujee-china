import { EXAMPLE_SLUGS } from '@/lib/examples/examples';

/** /examples plus one detail route per example, derived so they can't drift. */
const EXAMPLE_ROUTES: readonly string[] = [
  '/examples',
  ...EXAMPLE_SLUGS.map((slug) => `/examples/${slug}`),
];

/**
 * The locale-relative routes that belong in the sitemap.
 *
 * Everything else is deliberately absent:
 *   - /login, /register — crawlable (so the crawler can read it) but emit a
 *     `noindex` meta from their own page. Never add them here.
 *   - /my-albums, /credits, /settings, /admin — middleware 307s anonymous
 *     requests to /login, so a crawler can never reach them.
 */
export const INDEXABLE_ROUTES: readonly string[] = [
  '/',
  '/about/story',
  '/privacy',
  '/terms',
  ...EXAMPLE_ROUTES,
];

/**
 * Routes whose pages must emit `robots: NOINDEX`. Not consumed by robots.txt on
 * purpose — a Disallow would stop the crawler from ever fetching the page and
 * seeing that meta tag. This list exists so the test below can assert the two
 * sets never overlap.
 */
export const NOINDEX_ROUTES: readonly string[] = ['/login', '/register'];

/** Pages that change often enough to be worth re-crawling frequently. */
export const CHANGE_FREQUENCY: Record<string, 'weekly' | 'monthly' | 'yearly'> = {
  '/': 'weekly',
  // A founder story is written once. Claiming it changes weekly teaches Google
  // to ignore the signal on the pages where it is true.
  '/about/story': 'yearly',
  '/privacy': 'yearly',
  '/terms': 'yearly',
  ...Object.fromEntries(EXAMPLE_ROUTES.map((route) => [route, 'monthly' as const])),
};

export const ROUTE_PRIORITY: Record<string, number> = {
  '/': 1,
  // Below the landing page, well above the legal pages: it is the only page
  // carrying original first-person content, which is what earns rankings.
  '/about/story': 0.7,
  '/privacy': 0.3,
  '/terms': 0.3,
  '/examples': 0.7,
  ...Object.fromEntries(EXAMPLE_SLUGS.map((slug) => [`/examples/${slug}`, 0.6])),
};
