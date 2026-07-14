import type { Metadata } from 'next';
import { defaultLocale, type Locale, locales, localizePath } from '@/lib/i18n/routing';
import { absoluteUrl } from './site';

const OG_LOCALE: Record<Locale, string> = {
  en: 'en_US',
  zh: 'zh_CN',
};

export const OG_IMAGE = {
  url: absoluteUrl('/og/yujee-og.png'),
  width: 1200,
  height: 630,
  alt: 'A Yujee memoir spread — photos laid out as a printed magazine',
};

/**
 * Canonical + the full hreflang cluster for one locale-relative route.
 *
 * Both are required and they work as a pair: without them /en and /zh are two
 * near-identical pages competing for the same rankings, and www vs apex made it
 * four. Next renders `alternates.languages` as real <link rel="alternate"> tags
 * in <head> — next-intl only ever emitted them as an HTTP Link header, which
 * Google does read but which nothing else does.
 */
export function localeAlternates(route: string, locale: Locale): Metadata['alternates'] {
  const languages: Record<string, string> = Object.fromEntries(
    locales.map((l) => [l, absoluteUrl(localizePath(route, l))]),
  );
  languages['x-default'] = absoluteUrl(localizePath(route, defaultLocale));

  return {
    canonical: absoluteUrl(localizePath(route, locale)),
    languages,
  };
}

/** Open Graph + Twitter card. Without these a shared link renders as bare text. */
export function socialMetadata(
  route: string,
  locale: Locale,
  title: string,
  description: string,
): Pick<Metadata, 'openGraph' | 'twitter'> {
  const url = absoluteUrl(localizePath(route, locale));

  return {
    openGraph: {
      type: 'website',
      siteName: 'Yujee',
      title,
      description,
      url,
      locale: OG_LOCALE[locale],
      alternateLocale: locales.filter((l) => l !== locale).map((l) => OG_LOCALE[l]),
      images: [OG_IMAGE],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [OG_IMAGE.url],
    },
  };
}

/** Everything a public page needs: canonical, hreflang, OG, Twitter. */
export function publicPageMetadata(
  route: string,
  locale: Locale,
  title: string,
  description: string,
): Metadata {
  return {
    title,
    description,
    alternates: localeAlternates(route, locale),
    ...socialMetadata(route, locale, title, description),
  };
}

/** For pages that must never be indexed (auth). */
export const NOINDEX: Metadata['robots'] = {
  index: false,
  follow: true,
  googleBot: { index: false, follow: true },
};
