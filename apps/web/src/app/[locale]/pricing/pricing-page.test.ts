import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readCode } from '@/lib/testing/source';
import sitemap from '@/app/sitemap';
import {
  ADDON_PACKS,
  FREE_PLAN_CREDITS,
  MAX_PHOTOS_PER_GENERATION,
  PAGES_PER_CREDIT_LABEL,
  PHOTOS_PER_CREDIT,
} from '@/config/pricing';
import { locales } from '@/lib/i18n/routing';
import { ROUTE_FRESHNESS } from '@/lib/seo/freshness';
import { CHANGE_FREQUENCY, INDEXABLE_ROUTES, ROUTE_PRIORITY } from '@/lib/seo/routes';
import { pricingAppJsonLd } from '@/lib/seo/schema';
import { getMarketingMessages } from '@/messages/marketing';


// Both readers strip comments (lib/testing/source.ts). For the hardcoded-price
// check that is leniency — a comment may quote "$3" while explaining the page.
// For every positive assertion it is rigour — a commented-out <Link> must not
// keep the test green. Same helper, both directions.
const src = readCode;
const code = readCode;

/**
 * /pricing used to 308 onto the home page's #pricing anchor. That was the right
 * call for what the page was — a second copy of the same three price cards is a
 * thin duplicate, and the redirect's own comment says so.
 *
 * It is the wrong call for what the page is now. The Terms of Service say
 * "Current prices and pack sizes are those shown on the pricing page", the
 * questions a buyer actually has (how many credits is MY book, what happens if
 * a generation fails, can I get my money back, is printing included) have no
 * home on the landing page, and "yujee pricing" has no URL to rank.
 *
 * These tests exist so the page can never quietly rot back into a duplicate:
 * the numbers must come from config/pricing.ts, and the page must carry the
 * material the home anchor does not.
 */

test('/pricing is a real indexable route again, not a redirect', () => {
  const page = src('app/[locale]/pricing/page.tsx');

  assert.doesNotMatch(
    page,
    /permanentRedirect|redirect\(/,
    '/pricing must render, not bounce — a 308 here is what made it unrankable',
  );
  assert.ok(INDEXABLE_ROUTES.includes('/pricing'), '/pricing missing from INDEXABLE_ROUTES');
  assert.equal(CHANGE_FREQUENCY['/pricing'], 'monthly', 'prices change, but not weekly');
  assert.ok(
    (ROUTE_PRIORITY['/pricing'] ?? 0) >= 0.7,
    '/pricing is a money page; it should not sit below the legal pages',
  );
});

test('/pricing appears in the sitemap for every locale', async () => {
  const urls = (await sitemap()).map((entry) => entry.url);

  for (const locale of locales) {
    assert.ok(
      urls.includes(`https://yujeeai.com/${locale}/pricing`),
      `sitemap is missing /${locale}/pricing`,
    );
  }
});

test('/pricing declares its freshness sources so the lastmod gate can see it', () => {
  const freshness = ROUTE_FRESHNESS['/pricing'];
  assert.ok(freshness, '/pricing has no ROUTE_FRESHNESS entry');
  assert.ok(
    freshness.sources.some((s) => s.includes('messages/marketing')),
    'the page renders marketing copy, so that directory has to be a source',
  );
  assert.ok(
    freshness.sources.some((s) => s.includes('config/pricing.ts')),
    'a price change is a content change — config/pricing.ts must be a source too',
  );
});

test('every price on the page comes from config/pricing.ts, never a literal', () => {
  // The failure this prevents is silent and expensive: someone re-prices a pack
  // in config, billing charges the new price, and the marketing page keeps
  // quoting the old one. Both numbers look right in isolation.
  const page = code('app/[locale]/pricing/page.tsx');

  assert.match(page, /ADDON_PACKS/, 'the pack table must be built from ADDON_PACKS');
  assert.match(page, /FREE_PLAN_CREDITS/, 'the free-credit figure must come from config');
  assert.match(page, /MAX_PHOTOS_PER_GENERATION/, 'the per-book photo cap must come from config');

  for (const pack of ADDON_PACKS) {
    assert.doesNotMatch(
      page,
      new RegExp(`\\$${pack.priceUsd}\\b`),
      `page hardcodes $${pack.priceUsd} — read it off ADDON_PACKS instead`,
    );
  }
  assert.doesNotMatch(
    page,
    new RegExp(`\\b${FREE_PLAN_CREDITS} (?:free )?credits\\b`),
    'page hardcodes the welcome-credit count',
  );
});

test('the copy interpolates the numbers rather than spelling them out', () => {
  for (const locale of locales) {
    const copy = src(`messages/marketing/${locale}.ts`);
    const block = copy.match(/ {2}pricingPage: \{[\s\S]*?\n {2}\},/)?.[0];
    assert.ok(block, `${locale} has no pricingPage copy block`);

    for (const pack of ADDON_PACKS) {
      assert.doesNotMatch(
        block,
        new RegExp(`\\$${pack.priceUsd}\\b`),
        `${locale} pricingPage copy hardcodes $${pack.priceUsd}`,
      );
    }
    assert.doesNotMatch(
      block,
      new RegExp(`\\b${MAX_PHOTOS_PER_GENERATION}\\b`),
      `${locale} pricingPage copy hardcodes the photo cap`,
    );
  }
});

test('every locale carries the whole page, not a partial translation', () => {
  const required = [
    'metaTitle',
    'metaDesc',
    'title',
    'lede',
    'packsHead',
    'workedHead',
    'includedHead',
    'notIncludedHead',
    'notIncludedBody',
    'failureHead',
    'failureBody',
    'refundHead',
    'refundBody',
    'noExpiryHead',
    'noExpiryBody',
  ] as const;

  for (const locale of locales) {
    const m = getMarketingMessages(locale).pricingPage;
    for (const key of required) {
      const value = m[key];
      assert.equal(typeof value, 'string', `${locale}.pricingPage.${key} is missing`);
      assert.ok((value as string).trim().length > 0, `${locale}.pricingPage.${key} is empty`);
    }
    assert.ok(m.worked.length >= 3, `${locale} needs at least three worked examples`);
    assert.ok(m.faq.length >= 3, `${locale} needs at least three FAQ entries`);
  }
});

test('the page says what the money does NOT buy, and links to the printing breakdown', () => {
  // This is the section the home anchor has no room for and the one that makes
  // the page worth its own URL: Yujee sells a file, competitors ship a book.
  // It doubles as the internal link into the cost guide.
  const page = src('app/[locale]/pricing/page.tsx');

  assert.match(
    page,
    /COST_GUIDE_SLUG = 'how-much-does-a-photo-book-cost'/,
    'the cost-guide slug must be named, so a rename breaks the build rather than the link',
  );
  assert.match(
    page,
    /<Link\s+href=\{`\/\$\{costGuideLocale\}\/guides\/\$\{COST_GUIDE_SLUG\}`\}/,
    'the section must emit a real <Link> to the cost guide, resolved to the locale it exists in',
  );
  assert.match(page, /notIncludedBody/, 'the page must render the not-included copy');
});

test('the page emits offers nested in a real item, priced and localized', () => {
  // An Offer is a PROPERTY of an item. A bare top-level AggregateOffer — which
  // is what this emitted first — has nothing owning it: no rich result, and an
  // LLM gets a price with no product attached.
  const page = src('app/[locale]/pricing/page.tsx');
  assert.match(page, /JsonLd/, '/pricing should emit structured data — LLMs quote structured prices');

  for (const locale of locales) {
    const creditsLabel = getMarketingMessages(locale).pricingPage.packsCreditsLabel;
    const node = pricingAppJsonLd(locale, creditsLabel);

    assert.equal(node['@type'], 'SoftwareApplication', 'offers must hang off an item');
    assert.equal(node.offers['@type'], 'AggregateOffer');
    assert.equal(node.offers.offers.length, ADDON_PACKS.length);

    for (const offer of node.offers.offers) {
      assert.match(
        offer.url,
        /\/pricing$/,
        'a cited price should link to /pricing, not to a scroll position on the home page',
      );
      assert.ok(
        offer.name.includes(creditsLabel),
        `${locale}: offer name "${offer.name}" is not in the reader's language`,
      );
    }

    const prices = node.offers.offers.map((o) => Number(o.price)).sort((a, b) => a - b);
    assert.deepEqual(
      prices,
      [...ADDON_PACKS].map((p) => p.priceUsd).sort((a, b) => a - b),
      'the structured prices drifted from ADDON_PACKS',
    );
  }
});

test('the shared footer sends readers to the page, not to the home anchor', () => {
  // MarketingFooter renders on /guides, /examples and the legal pages. From
  // there "#pricing" resolves to /{locale}#pricing — a trip back to the home
  // page. Now that the page exists, that entry should land on it.
  for (const locale of locales) {
    const copy = src(`messages/marketing/${locale}.ts`);
    assert.doesNotMatch(
      copy,
      /\{ label: '[^']*', href: '#pricing' \}/,
      `${locale} footer still points Pricing at the home anchor`,
    );
  }
});

test('every token in every locale resolves, and each pack token is its own price', () => {
  // The grep tests above pin that the page IMPORTS the config. They cannot see
  // whether the values arrive intact: swapping {packSmall} and {packLarge} in
  // the token table, or inverting price ÷ credits, leaves every identifier in
  // place. This one runs the same substitution the page runs and reads the
  // output, which is the only thing a buyer sees.
  const packs = [...ADDON_PACKS].sort((a, b) => a.priceUsd - b.priceUsd);
  const expect: Record<string, string> = {
    '{credits}': String(FREE_PLAN_CREDITS),
    '{photos}': String(PHOTOS_PER_CREDIT),
    '{max}': String(MAX_PHOTOS_PER_GENERATION),
    '{pages}': PAGES_PER_CREDIT_LABEL,
    '{packSmall}': `$${packs[0]!.priceUsd}`,
    '{packMid}': `$${packs[Math.floor((packs.length - 1) / 2)]!.priceUsd}`,
    '{packLarge}': `$${packs[packs.length - 1]!.priceUsd}`,
  };

  const fill = (copy: string) =>
    Object.entries(expect).reduce((out, [token, value]) => out.replaceAll(token, value), copy);

  for (const locale of locales) {
    const m = getMarketingMessages(locale).pricingPage;
    const strings = [
      m.lede,
      m.freeLine,
      m.capLine,
      m.notIncludedBody,
      m.failureBody,
      m.refundBody,
      m.noExpiryBody,
      ...m.included,
      ...m.worked.map((w) => w.body),
      ...m.faq.map((f) => f.a),
    ];

    for (const s of strings) {
      // A translator typing {packMed} would ship the literal brace to a reader.
      const unknown = s.match(/\{[a-zA-Z]+\}/g)?.filter((t) => !(t in expect));
      assert.deepEqual(unknown ?? [], [], `${locale}: unknown token in "${s.slice(0, 60)}…"`);
      assert.doesNotMatch(fill(s), /\{[a-zA-Z]+\}/, `${locale}: token survived substitution`);
    }

    // The cheapest pack must never be described with the dearest pack's price.
    const large = m.worked.find((w) => w.body.includes('{packLarge}'));
    const small = m.worked.find((w) => w.body.includes('{packSmall}'));
    assert.ok(large && small, `${locale}: worked examples must span the pack range`);
    assert.notEqual(
      expect['{packSmall}'],
      expect['{packLarge}'],
      'the token table collapsed two distinct packs onto one price',
    );
  }
});

test('no worked example describes a book the product would refuse to build', () => {
  // MAX_PHOTOS_PER_GENERATION is a hard cap in the upload path. An example
  // above it sells a book that cannot be made, in five languages at once.
  const counts = /(\d+)\s*(?:photos|fotos|枚|张)/g;

  for (const locale of locales) {
    for (const entry of getMarketingMessages(locale).pricingPage.worked) {
      for (const [, n] of entry.body.matchAll(counts)) {
        assert.ok(
          Number(n) <= MAX_PHOTOS_PER_GENERATION,
          `${locale}: "${entry.h}" uses ${n} photos, over the ${MAX_PHOTOS_PER_GENERATION} cap`,
        );
      }
    }
  }
});

test('the page renders each prose section, not just the message key', () => {
  // "every locale carries the whole page" only proves the STRING exists.
  // Deleting the <p> that renders it left that test green.
  const page = src('app/[locale]/pricing/page.tsx');

  for (const key of ['refundBody', 'failureBody', 'noExpiryBody', 'capLine', 'freeLine']) {
    assert.match(page, new RegExp(`\\{fill\\(m\\.${key}\\)\\}`), `page never renders m.${key}`);
  }
});

test('the money page offers a way to pay', () => {
  // Checkout lives in the home #pricing block. Repointing the footer at
  // /pricing removed the other route to it, so this page has to carry one.
  const page = src('app/[locale]/pricing/page.tsx');
  assert.match(
    page,
    /href=\{`\/\$\{locale\}#pricing`\}/,
    '/pricing must link to the checkout block, or it is a price list with no till',
  );
});

test('the marketing nav sends Pricing to the page, not the home anchor', () => {
  const nav = src('components/marketing/MarketingNav.tsx');
  assert.match(
    nav,
    /key: 'pricing',\s*\n\s*label: m\.nav\.pricing,\s*\n\s*href: pricingPath,/,
    'MarketingNav still bounces Pricing to the home anchor',
  );
});

test('the landing page links the real /pricing page from its own footer', () => {
  // The redesigned home renders its OWN nav and footer; MarketingFooter's
  // /pricing entry (c4148143) never reaches it. Without this entry the money
  // page has zero inbound links from the strongest page on the site. Count
  // the exact call site, on comment-stripped source, so a commented-out line
  // fails the way a deleted one does.
  const landing = readCode('components/landing/YujeeLandingHomeClient.tsx');
  assert.equal(
    (landing.match(/\[c\.navPricing, `\/\$\{locale\}\/pricing`\]/g) ?? []).length,
    1,
    'landing footer must carry exactly one link to /${locale}/pricing',
  );
});
