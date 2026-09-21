import type { Locale } from '@/lib/i18n/routing';
import { en } from './en';
import { es } from './es';
import { fr } from './fr';
import { ja } from './ja';
import type { ExampleContent } from './types';
import { zh } from './zh';

export type { ExampleContent } from './types';

const BY_LOCALE: Record<Locale, Record<string, ExampleContent>> = { en, zh, es, ja, fr };

/** Content for one example in one locale. Falls back to English if a locale file
 *  is missing the slug — a new format must never 404 a whole page. */
export function contentFor(slug: string, locale: Locale): ExampleContent {
  return BY_LOCALE[locale][slug] ?? en[slug];
}

/**
 * Whether this locale carries its OWN copy for the slug, fallback excluded.
 *
 * The fallback above is a safety net for a half-shipped translation; it must
 * never become the way a page ships. The sitemap and hreflang claim every
 * example exists in all five locales (lib/seo/routes.ts), and serving English
 * at /es/examples/<slug> would make that a false claim — the same failure
 * guides.ts refuses by construction. examples.test.ts asserts this for every
 * example in every locale, because reading through contentFor() cannot tell a
 * translation from its fallback.
 */
export function hasOwnContent(slug: string, locale: Locale): boolean {
  return Object.hasOwn(BY_LOCALE[locale], slug);
}
