import { ADDON_PACKS, FREE_PLAN_CREDITS } from '@/config/pricing';
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
}

export function organizationSchema(): OrganizationSchema {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Yujee',
    alternateName: '遇己',
    url: SITE_URL,
    logo: absoluteUrl('/icon.png'),
    description:
      'Yujee turns your photos and stories into a magazine-style keepsake memoir, laid out by AI and exported as a print-ready PDF.',
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
      `${FREE_PLAN_CREDITS} free credit on sign-up`,
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
        name: pack.books === 1 ? '1 book' : `${pack.books} books`,
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
