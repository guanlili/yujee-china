import { defineRouting } from 'next-intl/routing';

export const locales = ['en', 'zh', 'es', 'ja', 'fr'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'en';
export const localeCookieName = 'YUJEE_LOCALE';

/**
 * Native-name label per locale. The only place a language name is spelled out —
 * every switcher (marketing nav, user menu, landing header, login page) reads
 * from here so a new locale never ships half-labelled.
 */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  zh: '中文',
  es: 'Español',
  ja: '日本語',
  fr: 'Français',
};

export const routing = defineRouting({
  locales,
  defaultLocale,
  localeDetection: false,
  localeCookie: {
    name: localeCookieName,
  },
  localePrefix: 'always',
  /**
   * OFF, and it must stay off. next-intl defaults this to true, which makes the
   * middleware attach an hreflang `Link:` header listing every locale above.
   *
   * That header is path-agnostic — it cannot know that a /guides article exists
   * in English only. It advertised four translations that 307 away and appear in
   * no sitemap, on the very response whose <head> correctly claimed one, and its
   * x-default pointed at the unprefixed URL, which 308s to /en. Google treats
   * the header, the <head> tags and the sitemap as three statements of one
   * cluster and discounts hreflang site-wide when they contradict each other, so
   * this would have cost the landing page and /examples their clusters too.
   *
   * Nothing is lost: every indexable page emits real <link rel="alternate"> tags
   * through publicPageMetadata → localeAlternates, which narrows per route via
   * localesForRoute. middleware.test.ts guards this.
   */
  alternateLinks: false,
});

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}

export function stripLocale(pathname: string): string {
  for (const locale of locales) {
    const prefix = `/${locale}`;
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      return pathname.slice(prefix.length) || '/';
    }
  }
  return pathname || '/';
}

export function detectLocale(pathname: string): Locale {
  const segment = pathname.split('/')[1] ?? '';
  return isLocale(segment) ? segment : defaultLocale;
}

export function localizePath(pathname: string, locale: Locale): string {
  const normalized = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const stripped = stripLocale(normalized);
  return stripped === '/' ? `/${locale}` : `/${locale}${stripped}`;
}
