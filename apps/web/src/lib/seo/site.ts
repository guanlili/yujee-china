/**
 * Canonical origin for every absolute URL we emit (canonical tags, hreflang,
 * sitemap, JSON-LD, OG).
 *
 * Hardcoded to the apex on purpose. Preview deployments must NOT advertise
 * themselves as canonical — Vercel already serves previews with
 * `x-robots-tag: noindex`, and pointing their canonicals at production is the
 * behaviour we want if one ever leaks into an index.
 *
 * 国内生产 canonical = https://outman.press（见 deploy/china/README）。
 */
export const SITE_URL = 'https://outman.press';

export function absoluteUrl(path: string): string {
  if (!path || path === '/') return SITE_URL;
  return `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}
