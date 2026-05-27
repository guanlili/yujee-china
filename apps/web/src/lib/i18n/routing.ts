import { defineRouting } from 'next-intl/routing';

export const locales = ['en', 'zh'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'en';
export const localeCookieName = 'YUJEE_LOCALE';

export const routing = defineRouting({
  locales,
  defaultLocale,
  localeDetection: false,
  localeCookie: {
    name: localeCookieName,
  },
  localePrefix: 'always',
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
