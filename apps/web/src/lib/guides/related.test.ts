import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { GUIDES, GUIDE_SLUGS, relatedGuides } from './guides';

const here = dirname(fileURLToPath(import.meta.url));
const webSrc = join(here, '..', '..');

function src(path: string): string {
  return readFileSync(join(webSrc, path), 'utf8');
}

function count(haystack: string, needle: RegExp): number {
  return haystack.match(needle)?.length ?? 0;
}

/**
 * The seven articles shipped as seven islands: nothing on the landing page
 * linked to /guides, and no article linked to any other article. A crawler
 * reached them through the sitemap alone, which is the one discovery path that
 * carries no weight at all. These tests pin the two halves of the fix — the
 * entry points into the library, and the edges between its articles.
 *
 * WHY THESE ASSERT ON COUNTS AND NOT SUBSTRINGS
 *
 * The first version of this file grepped for /\/guides/ and /relatedGuides/. A
 * review deleted the footer link, then the nav item, then swapped the sibling
 * <Link> for a <div> that emits no href — and every one of those regressions
 * stayed green, because some OTHER line in the same file still matched. A
 * substring test on a file this large asserts nothing. Count the specific call
 * sites instead, and let the count fail when one disappears.
 */

test('every guide names real sibling slugs — the RAW array, not the filtered result', () => {
  // relatedGuides() drops an unknown slug on purpose (a typo should cost one
  // link at render time, not the whole article). That means a test which only
  // inspects its OUTPUT cannot see the typo: a 3-entry list with one bad slug
  // returns 2 guides and sails past a `length >= 2` check. So walk the raw
  // field. This is the assertion that makes the "test catches the typo" promise
  // in guides.ts true.
  for (const guide of GUIDES) {
    assert.ok(
      guide.related.length >= 2,
      `${guide.slug} needs at least two siblings; a single link is a dead end, not a path`,
    );
    for (const slug of guide.related) {
      assert.ok(
        GUIDE_SLUGS.includes(slug),
        `${guide.slug} names "${slug}", which is not a guide — typo, or a renamed slug`,
      );
      assert.notEqual(slug, guide.slug, `${guide.slug} links to itself`);
    }
    assert.equal(
      new Set(guide.related).size,
      guide.related.length,
      `${guide.slug} lists the same sibling twice`,
    );
    assert.equal(
      relatedGuides(guide).length,
      guide.related.length,
      `${guide.slug} lost a sibling between the array and the helper`,
    );
  }
});

test('no guide is an orphan — every article is linked FROM somewhere else', () => {
  // relatedGuides is directional, so a guide can name two siblings and still be
  // named by nobody. That article keeps exactly the problem this change exists
  // to fix, and the per-guide test above would stay green through it.
  const inbound = new Map<string, string[]>(GUIDE_SLUGS.map((slug) => [slug, []]));

  for (const guide of GUIDES) {
    for (const sibling of relatedGuides(guide)) {
      inbound.get(sibling.slug)?.push(guide.slug);
    }
  }

  for (const [slug, sources] of inbound) {
    assert.ok(sources.length >= 1, `${slug} has no inbound link from any other guide`);
  }
});

test('the detail page emits a real href per sibling, inside a Link', () => {
  const page = src('app/[locale]/guides/[slug]/page.tsx');

  // The exact href expression. A <div data-slug={sibling.slug}> renders the
  // block and ships zero links; this is what tells the two apart.
  assert.equal(
    count(page, /href=\{`\/\$\{served\}\/guides\/\$\{sibling\.slug\}`\}/g),
    1,
    'sibling cards must link at `/${served}/guides/${sibling.slug}` — one Link, one href',
  );
  assert.match(page, /<Link\s+href=\{`\/\$\{served\}\/guides/, 'the sibling href must sit on a <Link>');
  assert.match(
    page,
    /siblings\.length \?/,
    'the block must be guarded — a bare "Read next" heading over an empty list is worse than no block',
  );
  assert.match(
    page,
    /served !== loc && \(/,
    'a sibling served in another language needs the same note the hub shows',
  );
});

test('the landing page keeps all three doors into /guides', () => {
  // The landing carries its own nav and footer rather than MarketingChrome's,
  // and that copy dropped the guides entry back when the pages did not exist.
  // Three call sites now: desktop nav, mobile sheet, footer column. Deleting any
  // one of them is a regression, and only a per-site count can see it.
  const landing = src('components/landing/YujeeLandingHomeClient.tsx');

  assert.equal(
    count(landing, /\[c\.footerGuides, `\/\$\{locale\}\/guides`\]/g),
    1,
    'landing footer lost its guides column entry',
  );
  assert.equal(
    // `[^>]*` so the desktop link's className sits between href and the label.
    count(landing, /href=\{`\/\$\{locale\}\/guides`\}[^>]*>\{c\.navGuides\}/g),
    2,
    'the guides nav link must appear in BOTH the desktop nav and the mobile sheet',
  );
});

test('the shared marketing nav carries a guides item', () => {
  const nav = src('components/marketing/MarketingNav.tsx');

  // Asserting on the navItems entry, not on the word "guides": the guidesPath
  // const alone kept an earlier version of this test green with the item gone.
  assert.match(
    nav,
    /key: 'guides',\s*\n\s*label: m\.nav\.guides,\s*\n\s*href: guidesPath,/,
    'MarketingNav must render a guides item built from m.nav.guides',
  );
});

test('every locale can name the guides library in both nav and footer', () => {
  for (const locale of ['en', 'zh', 'es', 'ja', 'fr']) {
    const copy = src(`components/landing/copy/${locale}.tsx`);
    assert.match(copy, /navGuides: '.+'/, `${locale} landing copy is missing navGuides`);
    assert.match(copy, /footerGuides: '.+'/, `${locale} landing copy is missing footerGuides`);

    const messages = src(`messages/marketing/${locale}.ts`);
    assert.match(messages, /guides: '.+'/, `${locale} marketing nav is missing a guides label`);
    assert.match(messages, /relatedHead: '.+'/, `${locale} guides copy is missing relatedHead`);
  }
});

test('the two footers use the SAME anchor text for /guides', () => {
  // The landing footer and MarketingFooter both point at /guides from every
  // locale. Two different anchor texts for one destination is a split signal and
  // reads as two different pages to anyone skimming.
  for (const locale of ['en', 'zh', 'es', 'ja', 'fr']) {
    const landingLabel = src(`components/landing/copy/${locale}.tsx`).match(
      /footerGuides: '(.+?)',/,
    )?.[1];
    const sharedLabel = src(`messages/marketing/${locale}.ts`).match(
      /\{ label: '(.+?)', href: '\/guides' \}/,
    )?.[1];

    assert.ok(landingLabel, `${locale}: no footerGuides label`);
    assert.ok(sharedLabel, `${locale}: no /guides entry in the shared footer`);
    assert.equal(landingLabel, sharedLabel, `${locale}: the two footers disagree on the label`);
  }
});
