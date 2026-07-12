import { headers } from 'next/headers';
import { defaultLocale, isLocale, type Locale } from './routing';

/**
 * next-intl's middleware injects the resolved locale as a request header on
 * every request it handles. The root layout sits ABOVE the [locale] segment, so
 * it has no `params` to read — this header is the only way it can know which
 * language it is rendering, and it needs to know in order to emit the right
 * `<html lang>`.
 *
 * `getLocale()` from next-intl/server does NOT work here: this app never
 * registered next-intl's server plugin (no createNextIntlPlugin in
 * next.config.mjs — messages are loaded by our own @/lib/i18n/messages), so
 * calling it throws "Couldn't find next-intl config file".
 *
 * Coupling to note: the header name is next-intl's internal contract. If a
 * major upgrade renames it we fall back to the default locale, which is the
 * behaviour we had before this file existed — degraded, not broken.
 */
const NEXT_INTL_LOCALE_HEADER = 'x-next-intl-locale';

export function resolveLocale(value: string | null | undefined): Locale {
  return value && isLocale(value) ? value : defaultLocale;
}

export async function getRequestLocale(): Promise<Locale> {
  const requestHeaders = await headers();
  return resolveLocale(requestHeaders.get(NEXT_INTL_LOCALE_HEADER));
}
