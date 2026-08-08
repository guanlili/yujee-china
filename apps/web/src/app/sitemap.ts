import type { MetadataRoute } from 'next';
import { defaultLocale, locales, localizePath } from '@/lib/i18n/routing';
import { contentUpdatedAt } from '@/lib/seo/freshness';
import { CHANGE_FREQUENCY, INDEXABLE_ROUTES, ROUTE_PRIORITY } from '@/lib/seo/routes';
import { absoluteUrl } from '@/lib/seo/site';

/**
 * One entry per (route × locale), each carrying the full hreflang cluster so
 * Google treats /en and /zh as translations of one page rather than duplicates
 * competing with each other.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  // `lastModified` is a hand-declared content date, never the build clock — see
  // lib/seo/freshness.ts for why that distinction is the whole point.
  return INDEXABLE_ROUTES.flatMap((route) => {
    const languages = Object.fromEntries(
      locales.map((locale) => [locale, absoluteUrl(localizePath(route, locale))]),
    );

    return locales.map((locale) => ({
      url: absoluteUrl(localizePath(route, locale)),
      lastModified: contentUpdatedAt(route),
      changeFrequency: CHANGE_FREQUENCY[route] ?? 'monthly',
      priority: ROUTE_PRIORITY[route] ?? 0.5,
      alternates: {
        languages: {
          ...languages,
          'x-default': absoluteUrl(localizePath(route, defaultLocale)),
        },
      },
    }));
  });
}
