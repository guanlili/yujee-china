import type { MetadataRoute } from 'next';
import { defaultLocale, locales, localizePath } from '@/lib/i18n/routing';
import { CHANGE_FREQUENCY, INDEXABLE_ROUTES, ROUTE_PRIORITY } from '@/lib/seo/routes';
import { absoluteUrl } from '@/lib/seo/site';

/**
 * One entry per (route × locale), each carrying the full hreflang cluster so
 * Google treats /en and /zh as translations of one page rather than duplicates
 * competing with each other.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  // No `lastModified`. It would have to be the build timestamp, which claims
  // every page changed on every deploy even when no copy moved — Google learns
  // to distrust a lastmod that always says "just now", and a wrong signal is
  // worse than none. Add it back only when it can be tied to real content dates.
  return INDEXABLE_ROUTES.flatMap((route) => {
    const languages = Object.fromEntries(
      locales.map((locale) => [locale, absoluteUrl(localizePath(route, locale))]),
    );

    return locales.map((locale) => ({
      url: absoluteUrl(localizePath(route, locale)),
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
