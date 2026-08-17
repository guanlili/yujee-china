import type { Locale } from '@/lib/i18n/routing';
import { en } from './en';
import type { GuideContent } from './types';

export type { GuideContent, GuideSection } from './types';

/**
 * One record per locale, keyed by slug. Adding a language means adding a file
 * here AND widening that guide's `availableLocales` — the array in guides.ts is
 * what the sitemap and hreflang read, so a translation nobody declares stays
 * invisible, and a declaration with no translation behind it throws below.
 */
const BY_LOCALE: Partial<Record<Locale, Record<string, GuideContent>>> = { en };

/**
 * NO ENGLISH FALLBACK, deliberately — this is where lib/examples/content
 * diverges, and the difference is the point.
 *
 * Examples are translated into all five locales, so falling back to English
 * there is a safety net that never fires. Guides ship in English first, so a
 * fallback WOULD fire, and it would silently serve English prose from a URL the
 * sitemap advertises as Spanish. Throwing instead means an undeclared locale is
 * caught by the callers, which redirect to English rather than fake it.
 */
export function contentFor(slug: string, locale: Locale): GuideContent {
  const content = BY_LOCALE[locale]?.[slug];
  if (!content) {
    throw new Error(
      `No ${locale} content for guide "${slug}". Callers must check availableLocales before rendering.`,
    );
  }
  return content;
}
