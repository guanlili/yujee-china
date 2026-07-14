/**
 * The locale-relative routes that belong in the sitemap.
 *
 * Everything else is deliberately absent:
 *   - /login, /register — crawlable (so the crawler can read it) but emit a
 *     `noindex` meta from their own page. Never add them here.
 *   - /my-albums, /credits, /settings, /admin — middleware 307s anonymous
 *     requests to /login, so a crawler can never reach them.
 */
export const INDEXABLE_ROUTES: readonly string[] = ['/', '/privacy', '/terms'];

/**
 * Routes whose pages must emit `robots: NOINDEX`. Not consumed by robots.txt on
 * purpose — a Disallow would stop the crawler from ever fetching the page and
 * seeing that meta tag. This list exists so the test below can assert the two
 * sets never overlap.
 */
export const NOINDEX_ROUTES: readonly string[] = ['/login', '/register'];

/** Pages that change often enough to be worth re-crawling frequently. */
export const CHANGE_FREQUENCY: Record<string, 'weekly' | 'yearly'> = {
  '/': 'weekly',
  '/privacy': 'yearly',
  '/terms': 'yearly',
};

export const ROUTE_PRIORITY: Record<string, number> = {
  '/': 1,
  '/privacy': 0.3,
  '/terms': 0.3,
};
