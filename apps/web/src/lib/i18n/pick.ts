import { OVERLAYS } from '@/messages/overlay';
import type { Locale } from './routing';

/**
 * Resolve one inline zh/en copy pair for the current locale.
 *
 * zh/en come straight from the pair. Every other locale looks the English string
 * up in its overlay table (@/messages/overlay) and falls back to English on a
 * miss — see that module for why the editor is translated this way.
 */
export function pick(locale: Locale, pair: { zh: string; en: string }): string {
  if (locale === 'zh') return pair.zh;
  if (locale === 'en') return pair.en;
  return OVERLAYS[locale]?.[pair.en] ?? pair.en;
}

/**
 * A locale-bound `pick`, threaded as a prop through the mobile editor tree the
 * way a `zh: boolean` used to be. Bind it once per mount: `aT(locale)`.
 */
export type AT = (zh: string, en: string) => string;

export function boundPick(locale: Locale): AT {
  return (zh, en) => pick(locale, { zh, en });
}
