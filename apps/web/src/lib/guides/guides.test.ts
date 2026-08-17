import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import sitemap from '@/app/sitemap';
import { ADDON_PACKS, FREE_PLAN_CREDITS } from '@/config/pricing';
import { locales, localizePath } from '@/lib/i18n/routing';
import { contentUpdatedAt } from '@/lib/seo/freshness';
import { localeAlternates, socialMetadata } from '@/lib/seo/metadata';
import { INDEXABLE_ROUTES, localesForRoute } from '@/lib/seo/routes';
import { absoluteUrl } from '@/lib/seo/site';
import {
  guideArticleSchema,
  guideBreadcrumb,
  guideFaqSchema,
  guideContent,
  GUIDES,
  guidesHubBreadcrumb,
  guidesItemList,
} from './guides';

test('localesForRoute narrows a guide to the locales it was actually translated into', () => {
  const guide = GUIDES[0];
  assert.ok(guide, 'the sample guide disappeared');
  assert.deepEqual(localesForRoute(`/guides/${guide.slug}`), guide.availableLocales);
});

test('nothing except a /guides article is ever narrowed', () => {
  // THE pin for this whole change. Every other test about the sitemap and the
  // hreflang clusters is derived from localesForRoute, so they would all follow
  // this function anywhere it went — including off a cliff. This one compares it
  // to the `locales` constant instead, which is the only independent oracle
  // available, and it walks EVERY indexable route rather than a hand-listed few
  // (an earlier version listed five by hand and left both /examples detail pages
  // unguarded).
  //
  // The production change this catches: widening the narrowing rule — say to any
  // two-segment route, or by giving Example an availableLocales field — which
  // would silently drop eight /examples URLs from the sitemap and shrink their
  // head clusters to English, with the whole suite still green.
  for (const route of INDEXABLE_ROUTES) {
    if (route.startsWith('/guides/')) continue;
    assert.deepEqual(localesForRoute(route), locales, `${route} lost locales`);
  }

  // The hub itself is chrome, translated into all five — only articles narrow.
  assert.deepEqual(localesForRoute('/guides'), locales);
});

test('the guides hub and every article are indexable routes', () => {
  assert.ok(INDEXABLE_ROUTES.includes('/guides'), 'the guides hub is missing from the sitemap');
  for (const guide of GUIDES) {
    assert.ok(
      INDEXABLE_ROUTES.includes(`/guides/${guide.slug}`),
      `/guides/${guide.slug} is missing from the sitemap`,
    );
  }
});

test('the sitemap never advertises a guide in a language it was not written in', () => {
  // The whole point of availableLocales. A URL here that has no translation
  // behind it is a page of English prose claiming to be Spanish.
  const urls = new Set(sitemap().map((e) => e.url));
  for (const guide of GUIDES) {
    const route = `/guides/${guide.slug}`;
    for (const locale of locales) {
      const url = absoluteUrl(localizePath(route, locale));
      const translated = guide.availableLocales.includes(locale);
      assert.equal(
        urls.has(url),
        translated,
        translated ? `${url} is translated but absent` : `${url} has no ${locale} translation`,
      );
    }
  }
});

test('a guide carries its own content date, not a row in the hand-kept freshness map', () => {
  // ROUTE_FRESHNESS exists because the marketing pages SHARE source files, so
  // "did this page's prose actually change" needs a human judgement call. A
  // guide owns its own content file, so the date belongs on the article and
  // updating one guide can never implicate another.
  for (const guide of GUIDES) {
    assert.equal(contentUpdatedAt(`/guides/${guide.slug}`), guide.updatedAt);
  }
});

test('the guides hub reports the most recent article date as its own', () => {
  // The hub renders every article's title and excerpt, so it genuinely changes
  // whenever the newest one does. A frozen hub lastmod teaches Google to stop
  // recrawling the one page that surfaces new articles.
  const newest = GUIDES.map((g) => g.updatedAt).sort().at(-1);
  assert.equal(contentUpdatedAt('/guides'), newest);
});

test('every guide date is a real calendar date, published no later than updated', () => {
  const today = new Date().toISOString().slice(0, 10);
  for (const { slug, publishedAt, updatedAt } of GUIDES) {
    for (const [field, value] of [['publishedAt', publishedAt], ['updatedAt', updatedAt]] as const) {
      assert.match(value, /^\d{4}-\d{2}-\d{2}$/, `${slug} ${field} "${value}" is not YYYY-MM-DD`);
      assert.equal(
        new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10),
        value,
        `${slug} ${field} "${value}" is not a real date`,
      );
      assert.ok(value <= today, `${slug} ${field} is in the future (${value})`);
    }
    assert.ok(publishedAt <= updatedAt, `${slug} claims it was updated before it was published`);
  }
});

test('every guide exists in English — x-default and the redirect fallback both assume it', () => {
  for (const guide of GUIDES) {
    assert.ok(
      guide.availableLocales.includes('en'),
      `${guide.slug} has no English version, so x-default points at a URL that is not in the sitemap`,
    );
  }
});

test('every hero is an opaque 1280x720 file that actually exists on disk', () => {
  // heroImage is NEVER rendered on the page. Its only consumers are the OG /
  // Twitter card and Article.image, and page.tsx hardcodes 1280x720 for it.
  //
  // Two guides originally pointed at 1536x1024 line-art PNGs that are ~95%
  // transparent. Existence checks passed, dimensions were declared wrong, and
  // the twitter:card is summary_large_image — so every share rendered thin dark
  // strokes on whatever the client composited behind them, i.e. a blank card on
  // any dark theme. An existence check alone would not have caught it.
  for (const guide of GUIDES) {
    const file = join(process.cwd(), 'public', guide.heroImage);
    assert.ok(existsSync(file), `${guide.slug} hero is missing: ${guide.heroImage}`);

    const bytes = readFileSync(file);
    assert.ok(
      !guide.heroImage.endsWith('.png') || bytes.readUInt8(25) < 4,
      `${guide.slug} hero is an alpha PNG — it will render blank on a dark background`,
    );

    // JPEG: walk the segment headers to SOFn, which carries the real dimensions.
    if (/\.jpe?g$/.test(guide.heroImage)) {
      let i = 2;
      while (i < bytes.length && !(bytes[i] === 0xff && bytes[i + 1] >= 0xc0 && bytes[i + 1] <= 0xcf
        && ![0xc4, 0xc8, 0xcc].includes(bytes[i + 1]))) i += 2 + bytes.readUInt16BE(i + 2);
      assert.equal(bytes.readUInt16BE(i + 7), 1280, `${guide.slug} hero is not 1280 wide`);
      assert.equal(bytes.readUInt16BE(i + 5), 720, `${guide.slug} hero is not 720 tall`);
    }
  }
});

test('every guide has real prose in each locale it claims, and no markup', () => {
  for (const guide of GUIDES) {
    for (const locale of guide.availableLocales) {
      const c = guideContent(guide, locale);
      assert.ok(c.title.length > 0, `${guide.slug} (${locale}) has no title`);
      assert.ok(c.excerpt.length > 0, `${guide.slug} (${locale}) has no excerpt`);
      assert.ok(c.sections.length >= 3, `${guide.slug} (${locale}) is too thin to rank`);

      for (const section of c.sections) {
        assert.ok(section.h.length > 0, `${guide.slug} has an unheaded section`);
        assert.ok(section.paras.length > 0, `${guide.slug} section "${section.h}" has no body`);
        // These render as text nodes, exactly like the story page.
        for (const p of section.paras) {
          assert.ok(!p.includes('**'), `"${p.slice(0, 40)}" still carries markdown emphasis`);
          assert.ok(!p.includes('<'), `"${p.slice(0, 40)}" carries markup`);
        }
      }
    }
  }
});

test('guide prose never hand-types a price — it derives from ADDON_PACKS', () => {
  // The bug this repo already ate once, recorded at the top of lib/seo/llms.ts:
  // the hand-written llms.txt went stale the first time the photos-per-credit
  // rule moved, because the constant changed and the prose did not. Same shape
  // here, worse blast radius — these articles are indexed AND feed Article
  // schema AND get read by AI crawlers. The denomination last moved 2026-07-17.
  const real = new Set<number>(ADDON_PACKS.map((p) => p.priceUsd));

  for (const guide of GUIDES) {
    for (const locale of guide.availableLocales) {
      const c = guideContent(guide, locale);
      const prose = [c.lede, ...c.sections.flatMap((s) => s.paras), ...(c.faq ?? []).map((f) => f.a)].join(' ');

      // Any price quoted as Yujee's must be a real pack price.
      for (const m of prose.matchAll(/(\d+) credits for (\d+) US dollars/g)) {
        assert.ok(real.has(Number(m[2])), `${guide.slug} quotes ${m[0]}, which is not an ADDON_PACKS price`);
      }
      for (const m of prose.matchAll(/(\d+) free credits/g)) {
        assert.equal(Number(m[1]), FREE_PLAN_CREDITS, `${guide.slug} states "${m[0]}" but the grant is ${FREE_PLAN_CREDITS}`);
      }
    }
  }
});

test('every guide title and description stays inside the SERP budget', () => {
  for (const guide of GUIDES) {
    const { metaTitle, metaDesc } = guideContent(guide, 'en');
    assert.ok(metaTitle.length <= 65, `${guide.slug} title is ${metaTitle.length} chars, over the 65 budget`);
    assert.ok(metaDesc.length <= 165, `${guide.slug} description is ${metaDesc.length} chars, over the 165 budget`);
  }
});

test('a guide owns its target query outright — no page competes with another', () => {
  // Same rule the /examples pages follow: one keyword, one page. A guide that
  // repeats the landing's terms is not new coverage, it is a second page bidding
  // against the homepage for a term the homepage already owns.
  const owned: Record<string, RegExp> = {
    'turn-old-family-photos-into-a-book': /old family photos into a book/i,
    'make-a-photo-book-from-iphone-photos': /photo book from iphone photos/i,
    'what-to-write-in-a-photo-book': /what to write in a photo book/i,
    'write-a-memoir-about-a-parent': /memoir about (your|a|my) (mother|father|parent)/i,
    'photo-book-vs-photo-album-vs-scrapbook': /photo book vs.? photo album/i,
    'how-much-does-a-photo-book-cost': /how much does a photo book cost/i,
    'how-to-choose-an-ai-photo-book-maker': /choose an ai photo book maker/i,
  };

  for (const [slug, pattern] of Object.entries(owned)) {
    const guide = GUIDES.find((g) => g.slug === slug);
    assert.ok(guide, `${slug} disappeared`);
    const c = guideContent(guide, 'en');
    assert.match(`${c.metaTitle} ${c.metaDesc}`, pattern, `${slug} dropped its target query from the SERP snippet`);
  }

  // No two guides may chase the same title.
  const titles = GUIDES.map((g) => guideContent(g, 'en').metaTitle);
  assert.equal(new Set(titles).size, titles.length, 'two guides ship the same SERP title');
});

test('guideArticleSchema mirrors the visible page and dates it honestly', () => {
  for (const guide of GUIDES) {
    for (const locale of guide.availableLocales) {
      const c = guideContent(guide, locale);
      const schema = guideArticleSchema(guide, locale);

      assert.equal(schema['@type'], 'Article');
      assert.equal(schema.headline, c.title, 'schema headline must match the visible H1');
      assert.equal(schema.description, c.metaDesc);
      assert.equal(schema.url, absoluteUrl(localizePath(`/guides/${guide.slug}`, locale)));
      assert.equal(schema.inLanguage, locale);
      // Google drops Article rich results without parseable ISO dates.
      assert.equal(schema.datePublished, guide.publishedAt);
      assert.equal(schema.dateModified, guide.updatedAt);
      // Yujee is the author of record; there is no named byline to claim.
      assert.equal(schema.author['@type'], 'Organization');
      assert.equal(schema.author.name, 'Yujee');
      assert.equal(schema.publisher.name, 'Yujee');
    }
  }
});

test('both guide pages ship a BreadcrumbList, like every other detail page here', () => {
  // /examples/<slug> ships one and the guides hub ships one; the article is the
  // page whose entire purpose is SERP presence, so it is the last one that
  // should be missing breadcrumb rich results.
  const hub = guidesHubBreadcrumb('en', 'Home', 'Guides');
  assert.equal(hub['@type'], 'BreadcrumbList');
  assert.deepEqual(
    hub.itemListElement.map((i) => i.item),
    [absoluteUrl('/en'), absoluteUrl('/en/guides')],
  );

  for (const guide of GUIDES) {
    for (const locale of guide.availableLocales) {
      const trail = guideBreadcrumb(guide, locale, 'Home', 'Guides');
      assert.equal(trail.itemListElement.length, 3, 'article breadcrumb must be Home / Guides / title');
      assert.deepEqual(
        trail.itemListElement.map((i) => i.item),
        [
          absoluteUrl(localizePath('/', locale)),
          absoluteUrl(localizePath('/guides', locale)),
          absoluteUrl(localizePath(`/guides/${guide.slug}`, locale)),
        ],
      );
      // The last crumb must be the visible H1, or the rich result and the page
      // disagree about what this page is called.
      assert.equal(trail.itemListElement[2].name, guideContent(guide, locale).title);
      trail.itemListElement.forEach((crumb, i) => assert.equal(crumb.position, i + 1));
    }
  }
});

test('a guide with an faq block emits FAQPage JSON-LD mirroring it exactly', () => {
  // The passage an AI engine quotes is a question-and-answer pair, not a page.
  // FAQPage is how that pairing is stated in a form ChatGPT, Perplexity and AI
  // Overviews can lift verbatim — the single highest-leverage schema for GEO.
  //
  // It must mirror what the reader sees. Google treats FAQPage markup that is
  // not visible on the page as a structured-data violation, and the whole point
  // is that a human and a crawler get the same answer.
  for (const guide of GUIDES) {
    for (const locale of guide.availableLocales) {
      const c = guideContent(guide, locale);
      const schema = guideFaqSchema(guide, locale);

      const faq = c.faq;
      if (!faq?.length) {
        assert.equal(schema, undefined, `${guide.slug} has no faq but emitted FAQPage`);
        continue;
      }

      assert.ok(schema, `${guide.slug} has an faq block but emitted no FAQPage`);
      assert.equal(schema['@type'], 'FAQPage');
      assert.equal(schema.mainEntity.length, faq.length);
      schema.mainEntity.forEach((item, i) => {
        assert.equal(item['@type'], 'Question');
        assert.equal(item.name, faq[i].q);
        assert.equal(item.acceptedAnswer.text, faq[i].a);
      });
    }
  }
});

test('faq answers are self-contained prose — an AI quotes them with no page around them', () => {
  for (const guide of GUIDES) {
    for (const locale of guide.availableLocales) {
      for (const { q, a } of guideContent(guide, locale).faq ?? []) {
        assert.ok(q.length > 0 && a.length > 0, `${guide.slug} has an empty faq entry`);
        assert.ok(!a.includes('<'), `${guide.slug} faq answer carries markup: "${q}"`);
        assert.ok(!a.includes('**'), `${guide.slug} faq answer carries markdown: "${q}"`);
        // A question that is not phrased as one will not match a spoken query.
        assert.ok(q.endsWith('?'), `${guide.slug} faq question is not a question: "${q}"`);
        // One-line answers do not survive being quoted out of context.
        assert.ok(a.length >= 80, `${guide.slug} faq answer is too thin to be quotable: "${q}"`);
      }
    }
  }
});

test('guidesItemList lists every article in the requested locale, English when untranslated', () => {
  // The hub is one page per locale and must list ALL articles, or a reader on
  // /es/guides sees a shorter library than a reader on /en/guides.
  for (const locale of locales) {
    const list = guidesItemList(locale);
    assert.equal(list['@type'], 'ItemList');
    assert.equal(list.itemListElement.length, GUIDES.length, `${locale} hub is missing articles`);

    list.itemListElement.forEach((item, i) => {
      const guide = GUIDES[i];
      const served = guide.availableLocales.includes(locale) ? locale : 'en';
      assert.equal(item.url, absoluteUrl(localizePath(`/guides/${guide.slug}`, served)));
      assert.equal(item.name, guideContent(guide, served).title);
    });
  }
});

test('the <head> hreflang tags narrow with the sitemap, not independently of it', () => {
  // Two separate emitters produce hreflang: the sitemap and this, which renders
  // <link rel="alternate"> into the page head. Narrowing only one leaves the
  // other advertising translations that do not exist — and the page head is the
  // copy Google trusts most, since it comes with the document itself.
  for (const guide of GUIDES) {
    const route = `/guides/${guide.slug}`;
    for (const locale of guide.availableLocales) {
      const languages = localeAlternates(route, locale)?.languages ?? {};
      const declared = Object.keys(languages).filter((k) => k !== 'x-default').sort();
      assert.deepEqual(declared, [...guide.availableLocales].sort(), `${route} head cluster drifted`);
    }
  }
});

test('og:locale:alternate narrows too — it is the same claim in a different vocabulary', () => {
  // Not an hreflang signal for Google, so it cannot poison the cluster, but it
  // is the same assertion ("this page exists in these languages") made to social
  // and AI crawlers, and it lives in the function already doing the narrowing.
  for (const guide of GUIDES) {
    for (const locale of guide.availableLocales) {
      const og = socialMetadata(`/guides/${guide.slug}`, locale, 'T', 'D').openGraph;
      const alternates = og?.alternateLocale ?? [];
      const expected = guide.availableLocales.filter((l) => l !== locale);
      assert.equal(
        (alternates as string[]).length,
        expected.length,
        `${guide.slug} advertises ${alternates} to social crawlers, but only exists in ${guide.availableLocales}`,
      );
    }
  }
});

test('the marketing pages keep all five og:locale:alternate entries', () => {
  const og = socialMetadata('/', 'en', 'T', 'D').openGraph;
  assert.equal((og?.alternateLocale as string[]).length, locales.length - 1);
});

test('the marketing pages keep all five hreflang tags in their <head>', () => {
  for (const route of ['/', '/about/story', '/examples']) {
    const languages = localeAlternates(route, 'en')?.languages ?? {};
    const declared = Object.keys(languages).filter((k) => k !== 'x-default').sort();
    assert.deepEqual(declared, [...locales].sort(), `${route} lost hreflang tags`);
  }
});

test('a guide hreflang cluster lists exactly its translated locales, plus x-default', () => {
  // hreflang and the sitemap rows must narrow together. Emitting the full
  // five-way cluster on an English-only article points four of the five tags at
  // URLs the sitemap does not carry — the mismatch Google discounts sitewide.
  const entries = sitemap();
  for (const guide of GUIDES) {
    for (const locale of guide.availableLocales) {
      const url = absoluteUrl(localizePath(`/guides/${guide.slug}`, locale));
      const entry = entries.find((e) => e.url === url);
      assert.ok(entry, `${url} missing from sitemap`);
      const languages = entry.alternates?.languages ?? {};
      const declared = Object.keys(languages).filter((k) => k !== 'x-default').sort();
      assert.deepEqual(declared, [...guide.availableLocales].sort(), `${url} hreflang cluster drifted`);
      assert.ok(languages['x-default'], `${url} is missing x-default`);
    }
  }
});
