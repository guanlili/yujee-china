import { ADDON_PACKS, FREE_PLAN_CREDITS } from '@/config/pricing';
import { SOCIAL_LINKS } from '@/config/social';
import { type Locale, localizePath } from '@/lib/i18n/routing';
import { getMarketingMessages } from '@/messages/marketing';
import { getFaqEntries } from './faq';
import { absoluteUrl, SITE_URL } from './site';

/**
 * JSON-LD emitted on the landing page.
 *
 * Deliberately absent: `aggregateRating` / `review`. Yujee has no public
 * reviews, and inventing them is both a Google structured-data violation and
 * the kind of thing that gets a site manually penalised. Add them only when
 * real reviews exist.
 */

interface Offer {
  '@type': 'Offer';
  price: string;
  priceCurrency: 'USD';
  name: string;
  url: string;
}

export interface SoftwareApplicationSchema {
  '@context': 'https://schema.org';
  '@type': 'SoftwareApplication';
  name: string;
  url: string;
  applicationCategory: string;
  operatingSystem: string;
  description: string;
  featureList: string[];
  offers: {
    '@type': 'AggregateOffer';
    priceCurrency: 'USD';
    lowPrice: string;
    highPrice: string;
    offerCount: number;
    offers: Offer[];
  };
}

export interface FaqPageSchema {
  '@context': 'https://schema.org';
  '@type': 'FAQPage';
  mainEntity: {
    '@type': 'Question';
    name: string;
    acceptedAnswer: { '@type': 'Answer'; text: string };
  }[];
}

export interface OrganizationSchema {
  '@context': 'https://schema.org';
  '@type': 'Organization';
  name: string;
  alternateName: string;
  url: string;
  logo: string;
  description: string;
  sameAs?: string[];
}

export interface ArticleSchema {
  '@context': 'https://schema.org';
  '@type': 'Article';
  headline: string;
  description: string;
  url: string;
  datePublished: string;
  author: { '@type': 'Person'; name: string };
  publisher: { '@type': 'Organization'; name: string; logo: string };
}

/** The founder story was published once and is not a running blog. */
export const STORY_AUTHOR = 'yvaine';
export const STORY_PUBLISHED = '2026-07-31';

/**
 * Article JSON-LD for /story.
 *
 * This is the one page on the site with a named human author, a date, and a
 * first-person account — exactly the experience signal Google's E-E-A-T
 * guidance rewards, and the reason the page is worth having at all. No
 * `dateModified`: it would have to be the build timestamp, which is the same
 * lie `sitemap.ts` deliberately refuses to tell.
 */
export function articleSchema(locale: Locale): ArticleSchema {
  const m = getMarketingMessages(locale).story;

  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: m.title,
    description: m.metaDesc,
    url: absoluteUrl(localizePath('/about/story', locale)),
    datePublished: STORY_PUBLISHED,
    author: { '@type': 'Person', name: STORY_AUTHOR },
    publisher: { '@type': 'Organization', name: 'Yujee', logo: absoluteUrl('/icon.png') },
  };
}

export function organizationSchema(): OrganizationSchema {
  // `sameAs` is what ties these accounts to the Yujee entity rather than
  // leaving them as unrelated profiles that happen to share a name. Derived
  // from SOCIAL_LINKS so a new account cannot land in the footer while the
  // schema still claims Yujee has none — and so an account with no href yet
  // (`href: ''`) never ships as an empty string here.
  const sameAs = SOCIAL_LINKS.filter((s) => s.href).map((s) => s.href);

  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Yujee',
    alternateName: '遇己',
    url: SITE_URL,
    logo: absoluteUrl('/icon.png'),
    description:
      'Yujee turns your photos and stories into a magazine-style keepsake memoir, laid out by AI and exported as a print-ready PDF.',
    ...(sameAs.length > 0 ? { sameAs } : {}),
  };
}

export function softwareApplicationSchema(locale: Locale): SoftwareApplicationSchema {
  const m = getMarketingMessages(locale).landing;
  const prices = ADDON_PACKS.map((p) => p.priceUsd);

  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Yujee',
    url: absoluteUrl(localizePath('/', locale)),
    applicationCategory: 'DesignApplication',
    operatingSystem: 'Web',
    description: m.metaDesc,
    featureList: [
      'AI photo grouping',
      'AI-written captions and chapter text',
      'Automatic magazine-style layout',
      'Chat-based editing',
      '300 DPI print-ready PDF export',
      `${FREE_PLAN_CREDITS} free credit${FREE_PLAN_CREDITS > 1 ? 's' : ''} on sign-up`,
    ],
    offers: {
      '@type': 'AggregateOffer',
      priceCurrency: 'USD',
      lowPrice: String(Math.min(...prices)),
      highPrice: String(Math.max(...prices)),
      offerCount: ADDON_PACKS.length,
      offers: ADDON_PACKS.map((pack) => ({
        '@type': 'Offer' as const,
        price: String(pack.priceUsd),
        priceCurrency: 'USD' as const,
        name: `${pack.books} credits`,
        url: absoluteUrl(`${localizePath('/', locale)}#pricing`),
      })),
    },
  };
}

export function faqPageSchema(locale: Locale): FaqPageSchema {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: getFaqEntries(locale).map((entry) => ({
      '@type': 'Question' as const,
      name: entry.q,
      acceptedAnswer: { '@type': 'Answer' as const, text: entry.a },
    })),
  };
}

/** Everything the landing page should emit, in one array. */
export function landingJsonLd(locale: Locale) {
  return [organizationSchema(), softwareApplicationSchema(locale), faqPageSchema(locale)];
}
