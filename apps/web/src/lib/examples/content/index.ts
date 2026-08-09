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
