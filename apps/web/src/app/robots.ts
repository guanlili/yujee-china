import type { MetadataRoute } from 'next';
import { absoluteUrl } from '@/lib/seo/site';

/**
 * Lives at app/ root, NOT under app/[locale]/. Next resolves metadata file
 * conventions before dynamic segments; put this one segment deeper and
 * `/robots.txt` gets matched as locale="robots.txt" and 404s — which is exactly
 * what production did before this file existed.
 *
 * Deliberately does NOT disallow /login and /register, even though they must
 * stay out of the index. A `Disallow` stops the crawler from FETCHING the page,
 * so it never sees the `noindex` meta those pages emit — and Google will still
 * index a disallowed URL it finds linked elsewhere, just without a snippet. The
 * two mechanisms cancel out. Crawlable + noindex is the combination that
 * actually removes a page from the index.
 *
 * /api/ is different: nothing there is linked or indexable to begin with, and
 * there is no HTML in which to put a meta tag.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: '/api/',
      },
    ],
    sitemap: absoluteUrl('/sitemap.xml'),
  };
}
