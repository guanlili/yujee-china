import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import robots from '@/app/robots';
import sitemap from '@/app/sitemap';
import { ADDON_PACKS, FREE_PLAN_CREDITS, PAGES_PER_CREDIT_LABEL, PHOTOS_PER_CREDIT } from '@/config/pricing';
import { locales, localizePath } from '@/lib/i18n/routing';
import { SOCIAL_LINKS } from '@/config/social';
import { EXAMPLES, exampleContent, getExample } from '@/lib/examples/examples';
import { getFaqEntries } from './faq';
import { contentUpdatedAt, FRESHNESS_DECLARATIONS, ROUTE_FRESHNESS } from './freshness';
import { buildLlmsTxt } from './llms';
import { INDEXABLE_ROUTES, localesForRoute, NOINDEX_ROUTES } from './routes';
import { articleSchema, faqPageSchema, organizationSchema, softwareApplicationSchema } from './schema';
import { absoluteUrl, SITE_URL } from './site';
import { getMarketingMessages } from '@/messages/marketing';

// copy/en.tsx is JSX and tsx emits the classic transform (tsconfig.base.json
// sets jsx: "preserve", which tsx ignores), so importing it into a plain
// node:test run needs React in scope. Supplying it is what lets the keyword
// guards below assert the value the page ACTUALLY renders — an earlier version
// of them regex'd the source file instead, and a dead `const legacy = {...}`
// carrying the keywords kept them green while the exported copy had none.
(globalThis as unknown as { React: typeof React }).React = React;

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

test('the password reset pages are noindex too', () => {
  // /reset-password is reached with a one-time token in the query string; an
  // indexed copy is a dead page at best and a leaked token at worst.
  assert.ok(NOINDEX_ROUTES.includes('/forgot-password'));
  assert.ok(NOINDEX_ROUTES.includes('/reset-password'));
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

// The four terms 小雨 picked for the 2026-09 push. They deliberately span two
// pages — the "one keyword, one page" test below is what keeps them from
// colliding, and this one keeps a later copy rewrite from silently dropping
// any of them. Same reasoning as the free + photo book layer above.
test('the four 2026-09 target keywords each still sit on their assigned page', () => {
  const landing = getMarketingMessages('en').landing;
  const landingMeta = `${landing.metaTitle} ${landing.metaDesc}`;
  assert.match(landing.metaTitle, /ai photobook generator/i, 'landing title dropped "AI Photobook Generator"');
  assert.match(landingMeta, /story-driven photobook/i, 'landing dropped "story-driven photobook"');
  assert.match(landingMeta, /ai photo storytelling/i, 'landing dropped "AI photo storytelling"');

  // "AI Travel Photobook" belongs to /examples/travel-journal, never the
  // landing — the other half of that split is the doesNotMatch below.
  const travel = getExample('travel-journal');
  assert.ok(travel, 'the travel-journal example disappeared');
  assert.match(
    exampleContent(travel, 'en').metaTitle,
    /ai travel photobook/i,
    'travel-journal title dropped "AI Travel Photobook"',
  );
});

// The landing H1 and eyebrow carry two of those terms in visible copy, not just
// in <head>. A meta-only keyword with no on-page backing is the pattern Google
// discounts, so they are pinned here too.
test('the landing hero copy carries the story-driven and storytelling terms', async () => {
  const { en } = await import('@/components/landing/copy/en');
  assert.match(en.createTitle, /story-driven photobook/i, 'the H1 dropped "story-driven photobook"');
  assert.match(en.heroEyebrow, /ai photo storytelling/i, 'the eyebrow dropped "AI photo storytelling"');
});

test('the landing title and description stay inside what a SERP actually shows', () => {
  // Past these lengths Google truncates mid-phrase and the keyword we just paid
  // for never renders. Latin script only — the zh budget is pixel-width, not
  // character count, so asserting a number there would be theatre.
  const { metaTitle, metaDesc } = getMarketingMessages('en').landing;
  assert.ok(metaTitle.length <= 65, `en title is ${metaTitle.length} chars, over the 65 SERP budget`);
  assert.ok(metaDesc.length <= 165, `en description is ${metaDesc.length} chars, over the 165 SERP budget`);
});

// Each target keyword lives on exactly ONE page. A single page cannot rank for
// "travel photobook" and "biography book" at once, and trying is what keyword
// stuffing looks like to Google. The landing keeps the generic terms; the
// /examples detail pages each own their format's term.
test('each example page owns its own format keyword — no two pages chase the same term', async () => {
  const owned: Record<string, RegExp[]> = {
    'travel-journal': [/travel photobook/i],
    'life-story': [/biography book/i, /memoir book/i],
    // The four formats added 2026-09-21. "photo magazine" is deliberately the
    // two-word form: the bare "magazine" SERP is fake-cover toys (see the July
    // competitor audit), and "portfolio book" / "pdf portfolio" are the
    // make-intent forms, not the "portfolio website" SaaS results.
    'year-in-review': [/year in review photo book/i],
    'growth-story': [/baby milestone book/i, /baby photo book/i],
    'photo-magazine': [/photo magazine/i],
    'portfolio-book': [/portfolio book/i, /pdf portfolio/i],
  };

  for (const [slug, patterns] of Object.entries(owned)) {
    const example = getExample(slug);
    assert.ok(example, `${slug} example disappeared`);
    const c = exampleContent(example, 'en');
    const page = [c.title, c.tagline, c.metaTitle, c.metaDesc, ...c.intro, ...c.inside].join(' ');
    for (const pattern of patterns) {
      assert.match(page, pattern, `${slug} no longer carries ${pattern}`);
    }
  }

  // The landing must NOT also chase the per-format terms, or the example pages
  // compete with their own homepage for them.
  const landing = getMarketingMessages('en').landing;
  const { en: copy } = await import('@/components/landing/copy/en');
  // The landing's VISIBLE copy counts too, not just its <head>. Checking only
  // the meta string let the hero eyebrow chase "AI travel photobook" while this
  // test stayed green — the presence half of the split reads on-page copy, so
  // the absence half has to read the same surface or the split is one-sided.
  const landingText = [landing.metaTitle, landing.metaDesc, copy.createTitle, copy.heroEyebrow].join(' ');
  assert.doesNotMatch(landingText, /travel photobook/i, 'the landing is competing with /examples/travel-journal');
  assert.doesNotMatch(landingText, /biography book/i, 'the landing is competing with /examples/life-story');
  assert.doesNotMatch(landingText, /year in review/i, 'the landing is competing with /examples/year-in-review');
  assert.doesNotMatch(landingText, /baby milestone|baby photo book/i, 'the landing is competing with /examples/growth-story');
  assert.doesNotMatch(landingText, /photo magazine/i, 'the landing is competing with /examples/photo-magazine');
  assert.doesNotMatch(landingText, /portfolio book|pdf portfolio/i, 'the landing is competing with /examples/portfolio-book');

  // Every example page owns a DIFFERENT term. Two pages carrying the same one
  // would split the signal between them — the exact thing the map above exists
  // to prevent, so the map itself is checked for overlap.
  for (const [slug, patterns] of Object.entries(owned)) {
    for (const [otherSlug, otherPatterns] of Object.entries(owned)) {
      if (slug === otherSlug) continue;
      const other = getExample(otherSlug);
      assert.ok(other);
      const c = exampleContent(other, 'en');
      const otherMeta = `${c.metaTitle} ${c.metaDesc}`;
      for (const pattern of patterns) {
        assert.doesNotMatch(otherMeta, pattern, `${otherSlug} <head> chases ${pattern}, which belongs to ${slug}`);
      }
      void otherPatterns;
    }
  }
});

// Anchor text is a relevance signal for the DESTINATION page, so both footers
// pointing at /examples/travel-journal should carry that page's term. There are
// two of them and they live in different files — the landing renders
// copy/en.tsx's footer, every other page renders the marketing one. The first
// pass at this changed only the marketing half and shipped; the landing footer
// stayed on the old wording until someone read the live HTML.
test('both footers link to the travel example with its own keyword as anchor text', async () => {
  const { en: copy } = await import('@/components/landing/copy/en');
  assert.match(copy.footerExampleTravel, /ai travel photobook/i, 'the landing footer anchor dropped the term');

  const marketing = JSON.stringify(getMarketingMessages('en'));
  assert.match(marketing, /ai travel photobook example/i, 'the marketing footer anchor dropped the term');
});

test('every example page title and description stays inside the SERP budget', () => {
  for (const example of EXAMPLES) {
    const { metaTitle, metaDesc } = exampleContent(example, 'en');
    assert.ok(metaTitle.length <= 65, `${example.slug} title is ${metaTitle.length} chars, over the 65 budget`);
    assert.ok(metaDesc.length <= 165, `${example.slug} description is ${metaDesc.length} chars, over the 165 budget`);
  }
});

test('the free-plan FAQ is phrased as the query people actually type', () => {
  // This entry is the on-page anchor for the "free photo book" intent and feeds
  // FAQPage JSON-LD verbatim. It must still state the real grant, not just the
  // keyword — a "free" promise the product does not honour buys a bounce.
  const entry = getFaqEntries('en').find((e) => /free/i.test(e.q));
  assert.ok(entry, 'the free-plan FAQ entry disappeared');
  assert.match(entry.q, /free/i);
  assert.match(entry.q, /photo book/i, 'the free question no longer names photo books');
  assert.match(entry.a, /free photobook/i, 'the answer dropped the joined "free photobook" spelling');
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

test('sitemap lists every indexable route in the locales it exists in, never an auth route', () => {
  // Not `INDEXABLE_ROUTES.length * locales.length` any more: a guide contributes
  // one row per language it was actually translated into. Marketing routes still
  // contribute five each, which is what makes this sum a real regression guard —
  // if the narrowing ever leaked onto them, this count drops.
  const entries = sitemap();
  const expected = INDEXABLE_ROUTES.reduce((n, route) => n + localesForRoute(route).length, 0);
  assert.equal(entries.length, expected);

  const urls = entries.map((e) => e.url);
  for (const locale of locales) {
    assert.ok(urls.includes(absoluteUrl(`/${locale}`)));
    for (const route of NOINDEX_ROUTES) {
      assert.ok(!urls.includes(absoluteUrl(`/${locale}${route}`)), `${route} leaked into sitemap`);
    }
  }
});

test('every sitemap entry declares exactly the locales its route exists in, plus x-default', () => {
  // Tightened from "carries all five" when guides arrived. Exact equality is the
  // stronger claim: it catches a cluster that advertises a translation the
  // sitemap does not list, which is the failure that gets hreflang discounted
  // sitewide — the old superset check would have passed straight through it.
  for (const entry of sitemap()) {
    const route = INDEXABLE_ROUTES.find((r) =>
      localesForRoute(r).some((l) => entry.url === absoluteUrl(localizePath(r, l))),
    );
    assert.ok(route, `${entry.url} belongs to no indexable route`);

    const languages = entry.alternates?.languages ?? {};
    const declared = Object.keys(languages).filter((k) => k !== 'x-default').sort();
    assert.deepEqual(declared, [...localesForRoute(route)].sort(), `${entry.url} hreflang cluster drifted`);
    assert.ok(languages['x-default'], `${entry.url} is missing x-default`);
  }
});

// lastmod used to be omitted entirely, because the only date available was the
// build timestamp — which claims every page changed on every deploy, and Google
// learns to ignore a lastmod that always says "just now". It is back now that
// it is tied to hand-declared content dates (see freshness.ts), which is the
// condition the old comment set for adding it.
test('no indexable route escapes the freshness gate', () => {
  // sitemap-freshness-check.ts iterates FRESHNESS_DECLARATIONS. Anything absent
  // from it has a lastmod that nothing verifies — edit the prose, forget the
  // date, and the sitemap tells Google the page is unchanged forever.
  //
  // Guides opt out of the hand-kept ROUTE_FRESHNESS map (they own their content
  // files, so the shared-source judgement call does not apply) but they must NOT
  // opt out of the gate. This test is what keeps those two facts separate — an
  // earlier version let guides skip both, and the script cheerfully reported
  // "7 routes" while the sitemap carried 9.
  const declared = Object.keys(FRESHNESS_DECLARATIONS).sort();
  assert.deepEqual(declared, [...INDEXABLE_ROUTES].sort(), 'a route is in the sitemap but not the gate');

  for (const [route, d] of Object.entries(FRESHNESS_DECLARATIONS)) {
    assert.ok(d.sources.length > 0, `${route} declares no sources, so the gate can never fire`);
    assert.ok(d.reviewedAt.length > 0, `${route} has no reviewedAt commit`);
    assert.equal(d.updatedAt, contentUpdatedAt(route), `${route} gate and sitemap disagree on lastmod`);
  }
});

test('every indexable route declares when its content last changed, and nothing else does', () => {
  // Two sources now: the hand-kept map for pages with shared content files, and
  // the guide's own `updatedAt` (see freshness.ts for why guides opt out). What
  // still must hold is total coverage — every sitemap row needs a real lastmod —
  // and no stale rows for routes that left the sitemap.
  for (const route of INDEXABLE_ROUTES) {
    assert.ok(contentUpdatedAt(route), `${route} is in the sitemap with no content date`);
  }
  for (const route of Object.keys(ROUTE_FRESHNESS)) {
    assert.ok(INDEXABLE_ROUTES.includes(route), `${route} has a freshness row but is not indexable`);
    assert.ok(!route.startsWith('/guides'), `${route} must carry its date on the article, not here`);
  }
});

test('content dates are real calendar dates, never in the future', () => {
  // A future lastmod is the other way to get the signal distrusted.
  const today = new Date().toISOString().slice(0, 10);
  for (const [route, { updatedAt }] of Object.entries(ROUTE_FRESHNESS)) {
    assert.match(updatedAt, /^\d{4}-\d{2}-\d{2}$/, `${route} updatedAt "${updatedAt}" is not YYYY-MM-DD`);
    assert.equal(
      new Date(`${updatedAt}T00:00:00Z`).toISOString().slice(0, 10),
      updatedAt,
      `${route} updatedAt "${updatedAt}" is not a real date`,
    );
    assert.ok(updatedAt <= today, `${route} claims it was updated in the future (${updatedAt})`);
  }
});

test('sitemap emits each route content date as lastModified, every locale', () => {
  for (const entry of sitemap()) {
    const route = INDEXABLE_ROUTES.find((r) =>
      localesForRoute(r).some((l) => entry.url === absoluteUrl(localizePath(r, l))),
    );
    assert.ok(route, `${entry.url} maps to no declared route`);
    assert.equal(entry.lastModified, contentUpdatedAt(route), `${entry.url} has the wrong lastmod`);
  }
});

test('sitemap is deterministic — no build clock leaks into lastmod', () => {
  // The regression that made lastmod untrustworthy in the first place. If any
  // date is computed from `new Date()`, two calls a moment apart can differ and
  // every deploy republishes "everything changed".
  assert.deepEqual(sitemap(), sitemap());
  for (const entry of sitemap()) {
    assert.equal(typeof entry.lastModified, 'string', `${entry.url} lastmod is not a fixed date string`);
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
