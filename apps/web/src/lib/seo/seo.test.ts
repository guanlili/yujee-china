import assert from 'node:assert/strict';
import { test } from 'node:test';
import robots from '@/app/robots';
import sitemap from '@/app/sitemap';
import { ADDON_PACKS } from '@/config/pricing';
import { locales } from '@/lib/i18n/routing';
import { getFaqEntries } from './faq';
import { INDEXABLE_ROUTES, NOINDEX_ROUTES } from './routes';
import { faqPageSchema, organizationSchema, softwareApplicationSchema } from './schema';
import { absoluteUrl, SITE_URL } from './site';

function disallowedPaths(): string[] {
  const { rules } = robots();
  return (Array.isArray(rules) ? rules : [rules]).flatMap((rule) => {
    const d = rule.disallow;
    if (!d) return [];
    return Array.isArray(d) ? d : [d];
  });
}

test('SITE_URL is the bare apex, no trailing slash', () => {
  assert.equal(SITE_URL, 'https://yujeeai.com');
  assert.ok(!SITE_URL.endsWith('/'));
});

test('absoluteUrl joins without double slashes and keeps the apex host', () => {
  assert.equal(absoluteUrl('/en'), 'https://yujeeai.com/en');
  assert.equal(absoluteUrl('en'), 'https://yujeeai.com/en');
  assert.equal(absoluteUrl('/'), 'https://yujeeai.com');
});

test('indexable routes exclude every auth/app route', () => {
  // Auth + logged-in surfaces carry no search value and must never be in the sitemap.
  for (const route of ['/login', '/register', '/my-albums', '/credits', '/settings', '/admin']) {
    assert.ok(!INDEXABLE_ROUTES.includes(route), `${route} must not be indexable`);
  }
  assert.ok(INDEXABLE_ROUTES.includes('/'));
  assert.ok(INDEXABLE_ROUTES.includes('/privacy'));
  assert.ok(INDEXABLE_ROUTES.includes('/terms'));
});

test('login and register are explicitly marked noindex', () => {
  assert.ok(NOINDEX_ROUTES.includes('/login'));
  assert.ok(NOINDEX_ROUTES.includes('/register'));
});

test('a route is never both indexable and noindex', () => {
  for (const route of NOINDEX_ROUTES) {
    assert.ok(!INDEXABLE_ROUTES.includes(route), `${route} is in both lists`);
  }
});

test('FAQ entries exist for every locale and are plain text', () => {
  for (const locale of locales) {
    const entries = getFaqEntries(locale);
    assert.ok(entries.length >= 6, `${locale} should expose the full FAQ`);
    for (const { q, a } of entries) {
      assert.equal(typeof q, 'string');
      assert.equal(typeof a, 'string');
      assert.ok(q.length > 0 && a.length > 0);
      // JSON-LD answers must be prose, not markup.
      assert.ok(!a.includes('<'), `answer for "${q}" must not contain markup`);
    }
  }
});

test('FAQ keeps the privacy answer — it is the top conversion blocker', () => {
  const en = getFaqEntries('en');
  const privacy = en.find((e) => e.q.toLowerCase().includes('safe'));
  assert.ok(privacy, 'an "are my photos safe" entry must exist');
  assert.match(privacy.a, /never uploaded/i);
});

test('faqPageSchema mirrors the visible FAQ exactly', () => {
  for (const locale of locales) {
    const entries = getFaqEntries(locale);
    const schema = faqPageSchema(locale);
    assert.equal(schema['@type'], 'FAQPage');
    assert.equal(schema.mainEntity.length, entries.length);
    schema.mainEntity.forEach((item, i) => {
      assert.equal(item['@type'], 'Question');
      assert.equal(item.name, entries[i].q);
      assert.equal(item.acceptedAnswer.text, entries[i].a);
    });
  }
});

test('softwareApplicationSchema derives every offer from ADDON_PACKS — no hand-typed prices', () => {
  const schema = softwareApplicationSchema('en');
  assert.equal(schema['@type'], 'SoftwareApplication');
  const offers = schema.offers.offers;
  assert.equal(offers.length, ADDON_PACKS.length);
  ADDON_PACKS.forEach((pack, i) => {
    assert.equal(offers[i].price, String(pack.priceUsd));
    assert.equal(offers[i].priceCurrency, 'USD');
  });
  // Cheapest pack drives the lowPrice on the aggregate.
  const cheapest = Math.min(...ADDON_PACKS.map((p) => p.priceUsd));
  assert.equal(schema.offers.lowPrice, String(cheapest));
});

test('organizationSchema points at the apex and names the brand in both scripts', () => {
  const schema = organizationSchema();
  assert.equal(schema['@type'], 'Organization');
  assert.equal(schema.url, SITE_URL);
  assert.ok(schema.name.includes('Yujee'));
  assert.ok(schema.logo.startsWith(SITE_URL));
});

test('robots.txt must NOT Disallow the noindex routes', () => {
  // A Disallow stops the crawler fetching the page, so it never reads the
  // `noindex` meta the page emits — and Google will still index a disallowed
  // URL it finds linked, just without a snippet. Crawlable + noindex is the
  // only combination that actually de-indexes. Regression guard.
  const disallowed = disallowedPaths();
  for (const route of NOINDEX_ROUTES) {
    for (const locale of locales) {
      assert.ok(
        !disallowed.includes(`/${locale}${route}`),
        `/${locale}${route} is Disallowed, which hides its noindex meta from crawlers`,
      );
    }
  }
});

test('robots.txt still blocks /api/ and advertises the sitemap', () => {
  assert.ok(disallowedPaths().includes('/api/'));
  assert.equal(robots().sitemap, absoluteUrl('/sitemap.xml'));
});

test('sitemap lists every indexable route in both locales, never an auth route', () => {
  const entries = sitemap();
  assert.equal(entries.length, INDEXABLE_ROUTES.length * locales.length);

  const urls = entries.map((e) => e.url);
  for (const locale of locales) {
    assert.ok(urls.includes(absoluteUrl(`/${locale}`)));
    for (const route of NOINDEX_ROUTES) {
      assert.ok(!urls.includes(absoluteUrl(`/${locale}${route}`)), `${route} leaked into sitemap`);
    }
  }
});

test('every sitemap entry carries the full hreflang cluster including x-default', () => {
  for (const entry of sitemap()) {
    const languages = entry.alternates?.languages ?? {};
    for (const locale of locales) {
      assert.ok(languages[locale], `${entry.url} is missing hreflang=${locale}`);
    }
    assert.ok(languages['x-default'], `${entry.url} is missing x-default`);
  }
});

test('sitemap omits lastModified rather than claiming every page changed on every deploy', () => {
  for (const entry of sitemap()) {
    assert.equal(entry.lastModified, undefined);
  }
});
