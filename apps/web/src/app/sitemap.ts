import type { MetadataRoute } from 'next';
import { localizePath } from '@/lib/i18n/routing';
import { contentUpdatedAt } from '@/lib/seo/freshness';
import { CHANGE_FREQUENCY, INDEXABLE_ROUTES, localesForRoute, ROUTE_PRIORITY, xDefaultLocaleForRoute } from '@/lib/seo/routes';
import { absoluteUrl } from '@/lib/seo/site';

/**
 * One entry per (route × locale it exists in), each carrying the hreflang
 * cluster for that route so Google treats /en and /zh as translations of one
 * page rather than duplicates competing with each other.
 *
 * The locale list is per-route (`localesForRoute`), not the global `locales`.
 * Marketing pages are translated into all five and are unaffected; a guide that
 * only exists in English contributes exactly one row and a one-entry cluster.
 * Listing an untranslated URL here would advertise English prose as Spanish.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  // `lastModified` is a hand-declared content date, never the build clock — see
  // lib/seo/freshness.ts for why that distinction is the whole point.
  return INDEXABLE_ROUTES.flatMap((route) => {
    const routeLocales = localesForRoute(route);
    const languages = Object.fromEntries(
      routeLocales.map((locale) => [locale, absoluteUrl(localizePath(route, locale))]),
    );

    return routeLocales.map((locale) => ({
      url: absoluteUrl(localizePath(route, locale)),
      lastModified: contentUpdatedAt(route),
      changeFrequency: CHANGE_FREQUENCY[route] ?? 'monthly',
      priority: ROUTE_PRIORITY[route] ?? 0.5,
      alternates: {
        languages: {
          ...languages,
          'x-default': absoluteUrl(localizePath(route, xDefaultLocaleForRoute(route))),
        },
      },
    }));
  });
}
