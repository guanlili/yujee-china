import assert from 'node:assert/strict';
import { test } from 'node:test';
import robots from '@/app/robots';
import sitemap from '@/app/sitemap';
import { ADDON_PACKS, FREE_PLAN_CREDITS, PAGES_PER_CREDIT_LABEL, PHOTOS_PER_CREDIT } from '@/config/pricing';
import { locales } from '@/lib/i18n/routing';
import { SOCIAL_LINKS } from '@/config/social';
import { getFaqEntries } from './faq';
import { buildLlmsTxt } from './llms';
import { INDEXABLE_ROUTES, NOINDEX_ROUTES } from './routes';
import { articleSchema, faqPageSchema, organizationSchema, softwareApplicationSchema } from './schema';
import { absoluteUrl, SITE_URL } from './site';
import { getMarketingMessages } from '@/messages/marketing';

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
  assert.ok(INDEXABLE_ROUTES.includes('/about/story'));
});

test('the founder story exists in both locales and is real prose, not markup', () => {
  for (const locale of locales) {
    const s = getMarketingMessages(locale).story;
    assert.ok(s.metaTitle.length > 0 && s.metaDesc.length > 0);
    assert.ok(s.lede.length > 0, `${locale} story needs an opening`);
    assert.ok(s.sections.length >= 6, `${locale} story lost sections`);

    for (const section of s.sections) {
      assert.ok(section.h.length > 0);
      assert.ok(section.paras.length > 0, `section "${section.h}" has no body`);
      // The page renders these as text nodes. Markdown emphasis or HTML here
      // would ship to the user literally.
      for (const p of [...section.paras, ...(section.bullets ?? []), section.pull ?? '']) {
        assert.ok(!p.includes('**'), `"${p.slice(0, 40)}" still carries markdown emphasis`);
        assert.ok(!p.includes('<'), `"${p.slice(0, 40)}" carries markup`);
      }
    }
  }
});

const footerItems = (locale: (typeof locales)[number]) =>
  getMarketingMessages(locale).footer.groups.flatMap((g) => g.items);

test('the story page is reachable from every page, or nothing links to it', () => {
  // A page absent from the sitemap-linked navigation is an orphan: crawlers can
  // only reach it via the sitemap, and Google discounts pages nothing links to.
  for (const locale of locales) {
    const hrefs = footerItems(locale).map((i) => i.href);
    assert.ok(hrefs.includes('/about/story'), `${locale} footer does not link the story`);
  }
});

test('the story sits in the About group, not Product — the footer groups carry meaning', () => {
  // Group headings are the cheapest on-page signal about what a page IS. A
  // founder story filed under "Product" reads to a crawler as a feature page.
  for (const locale of locales) {
    const { groups } = getMarketingMessages(locale).footer;
    const owner = groups.find((g) => g.items.some((i) => i.href === '/about/story'));
    assert.ok(owner, `${locale} footer does not link the story at all`);
    assert.equal(owner.items.length, 1, 'the About group should not accumulate unrelated links');
    const product = groups[0];
    assert.ok(
      !product.items.some((i) => i.href === '/about/story'),
      `${locale} still lists the story under the first (product) group`,
    );
  }
});

test('every footer link target is a real route, a real anchor, or a mailto', () => {
  // A footer ships on every page, so one dead href is a sitewide broken link.
  // Landing anchors are checked against the ids the landing actually renders —
  // the nav already ships a `#how` that no section answers to.
  const routes = new Set([...INDEXABLE_ROUTES, '/about']);
  const anchors = new Set(['#homepage-composer', '#features', '#outputs', '#pricing', '#faq']);

  for (const locale of locales) {
    for (const { href } of footerItems(locale)) {
      if (href.startsWith('mailto:')) {
        assert.match(href, /^mailto:[^@\s]+@[^@\s]+$/, `${locale} footer has a malformed mailto: ${href}`);
        continue;
      }
      if (href.startsWith('#')) {
        assert.ok(anchors.has(href), `${locale} footer links ${href}, which no landing section renders`);
        continue;
      }
      assert.ok(routes.has(href.split('#')[0]), `${locale} footer links ${href}, which is not a route`);
    }
  }
});

test('footer groups are non-empty and uniquely headed in both locales', () => {
  for (const locale of locales) {
    const { groups } = getMarketingMessages(locale).footer;
    assert.ok(groups.length >= 4, `${locale} footer lost a group`);
    const heads = groups.map((g) => g.head);
    assert.equal(new Set(heads).size, heads.length, `${locale} footer has duplicate group headings`);
    for (const g of groups) {
      assert.ok(g.head.length > 0 && g.items.length > 0, `${locale} group "${g.head}" is empty`);
      for (const i of g.items) assert.ok(i.label.length > 0, `${locale} group "${g.head}" has an unlabeled link`);
    }
  }
  // Both locales must offer the same set of destinations, or one language
  // quietly loses a page.
  const [en, zh] = locales.map((l) => footerItems(l).map((i) => i.href).sort());
  assert.deepEqual(en, zh, 'en and zh footers point at different places');
});

test('articleSchema describes the story page with a real author and date', () => {
  for (const locale of locales) {
    const schema = articleSchema(locale);
    assert.equal(schema['@type'], 'Article');
    assert.equal(schema.url, absoluteUrl(`/${locale}/about/story`));
    assert.equal(schema.author['@type'], 'Person');
    assert.ok(schema.author.name.length > 0);
    // Google drops Article rich results without a parseable ISO date.
    assert.match(schema.datePublished, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(schema.publisher.name, 'Yujee');
    assert.equal(schema.headline, getMarketingMessages(locale).story.title);
  }
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

// The landing carries one deliberate keyword layer: "free" + "photo book
// layout". It is the winnable half of the free-photo-book demand (the bare
// "free photo book maker" head term belongs to Shutterfly/Canva and is not
// contestable from a new domain), and it is honest — FREE_PLAN_CREDITS covers a
// whole book. Copy rewrites drop keywords silently; these tests make that loud.
test('the landing title and description carry the free + photo book keywords in both locales', () => {
  const en = getMarketingMessages('en').landing;
  assert.match(en.metaTitle, /free/i, 'en title dropped "free"');
  assert.match(en.metaTitle, /photo book/i, 'en title dropped "photo book"');
  assert.match(en.metaDesc, /free/i, 'en description dropped "free"');
  assert.match(en.metaDesc, /photo book layout/i, 'en description dropped "photo book layout"');

  const zh = getMarketingMessages('zh').landing;
  assert.match(zh.metaTitle, /免费/, 'zh title dropped 免费');
  assert.match(zh.metaTitle, /照片书/, 'zh title dropped 照片书');
  assert.match(zh.metaDesc, /免费/, 'zh description dropped 免费');
  assert.match(zh.metaDesc, /排版/, 'zh description dropped 排版');
});

test('the landing title and description stay inside what a SERP actually shows', () => {
  // Past these lengths Google truncates mid-phrase and the keyword we just paid
  // for never renders. Latin script only — the zh budget is pixel-width, not
  // character count, so asserting a number there would be theatre.
  const { metaTitle, metaDesc } = getMarketingMessages('en').landing;
  assert.ok(metaTitle.length <= 65, `en title is ${metaTitle.length} chars, over the 65 SERP budget`);
  assert.ok(metaDesc.length <= 165, `en description is ${metaDesc.length} chars, over the 165 SERP budget`);
});

test('the free-plan FAQ is phrased as the query people actually type', () => {
  // This entry is the on-page anchor for the "free photo book" intent and feeds
  // FAQPage JSON-LD verbatim. It must still state the real grant, not just the
  // keyword — a "free" promise the product does not honour buys a bounce.
  const entry = getFaqEntries('en').find((e) => /free/i.test(e.q));
  assert.ok(entry, 'the free-plan FAQ entry disappeared');
  assert.match(entry.q, /free/i);
  assert.match(entry.q, /photo book/i, 'the free question no longer names photo books');
  assert.match(entry.a, new RegExp(`${FREE_PLAN_CREDITS} free credits?\\b`), 'the answer stopped stating the real grant');
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

test('organizationSchema sameAs mirrors the live social accounts, never an empty href', () => {
  const live = SOCIAL_LINKS.filter((s) => s.href).map((s) => s.href);
  const schema = organizationSchema();
  assert.deepEqual(schema.sameAs ?? [], live);
  for (const url of schema.sameAs ?? []) {
    assert.ok(url.startsWith('https://'), `sameAs entry ${url} is not an absolute https URL`);
  }
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

// llms.txt used to be a hand-written public/llms.txt. It went stale the moment
// PHOTOS_PER_CREDIT moved (10 → 20, later → 1): the constant changed, the file
// kept the old number. It is generated now — these tests keep it that way.
test('llms.txt derives the photos-per-credit rule from the constant, never a typed number', () => {
  const txt = buildLlmsTxt();
  assert.match(txt, new RegExp(`1 credit = ${PHOTOS_PER_CREDIT} photos?\\b`));
  assert.match(txt, new RegExp(`usually ${PAGES_PER_CREDIT_LABEL} pages`));
  assert.match(txt, new RegExp(`${FREE_PLAN_CREDITS} free credits?\\b`));

  // No OTHER photo count may appear — a stale hardcoded number would show up here.
  // `photos?` catches the singular the 1-credit-per-photo rule now uses.
  const counts = [...txt.matchAll(/(\d+) photos?\b/g)].map((m) => Number(m[1]));
  assert.ok(counts.length > 0, 'llms.txt should state the photo rule at all');
  for (const n of counts) {
    assert.equal(n, PHOTOS_PER_CREDIT, `llms.txt states "${n} photos" but the rule is ${PHOTOS_PER_CREDIT}`);
  }
});

test('llms.txt lists every pack from ADDON_PACKS at its real price — no hand-typed prices', () => {
  const txt = buildLlmsTxt();
  for (const pack of ADDON_PACKS) {
    const plural = pack.books > 1 ? 's' : '';
    assert.match(
      txt,
      new RegExp(`- ${pack.books} credit${plural} — \\$${pack.priceUsd}$`, 'm'),
      `pack ${pack.id} missing or mispriced in llms.txt`,
    );
  }
  // Every "$N" in the file must be a real pack price.
  const prices = [...txt.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
  const real = new Set<number>(ADDON_PACKS.map((p) => p.priceUsd));
  for (const p of prices) assert.ok(real.has(p), `llms.txt quotes $${p}, which is not an ADDON_PACKS price`);
});

test('llms.txt promises no shipment and no subscription — both were ruled out', () => {
  const txt = buildLlmsTxt();
  assert.match(txt, /No subscription\./);
  assert.doesNotMatch(txt, /\b(monthly|per month|\/mo|subscribe)\b/i);
  // We hand over a PDF; we do not print and ship it.
  assert.match(txt, /not a shipment/);
});
