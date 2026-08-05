import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { locales } from '@/lib/i18n/routing';
import { INDEXABLE_ROUTES } from '@/lib/seo/routes';
import { SITE_URL } from '@/lib/seo/site';
import {
  EXAMPLE_SLUGS,
  EXAMPLES,
  exampleBreadcrumb,
  exampleContent,
  exampleCreativeWork,
  examplesItemList,
  getExample,
} from './examples';

/** A public asset path like "/examples/x/spread-01.jpg" must resolve to a real file. */
function publicFileExists(publicPath: string): boolean {
  assert.ok(publicPath.startsWith('/'), `${publicPath} must be a root-relative asset path`);
  return existsSync(path.join(process.cwd(), 'public', publicPath.slice(1)));
}

test('slugs are unique and URL-safe', () => {
  assert.ok(EXAMPLE_SLUGS.length > 0);
  assert.equal(new Set(EXAMPLE_SLUGS).size, EXAMPLE_SLUGS.length, 'duplicate slug');
  for (const slug of EXAMPLE_SLUGS) {
    assert.match(slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `${slug} is not a clean slug`);
  }
});

test('every example carries complete, non-empty copy in both locales', () => {
  for (const example of EXAMPLES) {
    for (const locale of locales) {
      const c = exampleContent(example, locale);
      for (const [field, value] of Object.entries({
        title: c.title,
        tagline: c.tagline,
        metaTitle: c.metaTitle,
        metaDesc: c.metaDesc,
      })) {
        assert.equal(typeof value, 'string');
        assert.ok(value.trim().length > 0, `${example.slug}.${locale}.${field} is empty`);
      }
      assert.ok(c.intro.length >= 1, `${example.slug}.${locale} needs intro prose`);
      assert.ok(c.inside.length >= 1, `${example.slug}.${locale} needs "inside" bullets`);
      assert.ok(c.madeWith.length >= 1, `${example.slug}.${locale} needs "madeWith"`);
      assert.equal(
        c.galleryAlt.length,
        example.gallery.length,
        `${example.slug}.${locale} galleryAlt must match gallery length`,
      );
      for (const alt of c.galleryAlt) assert.ok(alt.trim().length > 0, 'empty alt text');
      // JSON-LD reuses the tagline as its description — keep it prose, not markup.
      assert.ok(!c.tagline.includes('<'), 'tagline leaks markup into JSON-LD');
    }
  }
});

test('every referenced media asset exists on disk (no broken links)', () => {
  for (const example of EXAMPLES) {
    assert.ok(example.gallery.length >= 3, `${example.slug} needs at least 3 spreads`);
    assert.ok(publicFileExists(example.cardImage), `${example.slug} cardImage missing`);
    assert.ok(publicFileExists(example.video), `${example.slug} video missing`);
    assert.ok(publicFileExists(example.poster), `${example.slug} poster missing`);
    for (const src of example.gallery) {
      assert.ok(src.startsWith(`/examples/${example.slug}/`), `${src} not namespaced by slug`);
      assert.ok(publicFileExists(src), `${src} missing on disk`);
    }
  }
});

test('getExample resolves known slugs and rejects unknown ones', () => {
  assert.ok(getExample(EXAMPLE_SLUGS[0]));
  assert.equal(getExample('not-a-real-example'), undefined);
});

test('every example route is indexable (in the sitemap set)', () => {
  assert.ok(INDEXABLE_ROUTES.includes('/examples'), '/examples must be indexable');
  for (const slug of EXAMPLE_SLUGS) {
    assert.ok(INDEXABLE_ROUTES.includes(`/examples/${slug}`), `/examples/${slug} not indexable`);
  }
});

test('CreativeWork schema mirrors the visible page and stays on the apex', () => {
  for (const example of EXAMPLES) {
    for (const locale of locales) {
      const c = exampleContent(example, locale);
      const schema = exampleCreativeWork(example, locale, 'Examples');
      assert.equal(schema['@type'], 'CreativeWork');
      assert.equal(schema.name, c.title);
      // description must equal what a visitor reads — no invented copy.
      assert.equal(schema.description, c.tagline);
      assert.equal(schema.image.length, example.gallery.length);
      assert.ok(schema.url.startsWith(SITE_URL), 'schema url must be on the apex');
      assert.ok(schema.image.every((u) => u.startsWith(SITE_URL)), 'schema images must be absolute');
      // No invented reviews/ratings — same rule schema.ts enforces for the landing.
      assert.ok(!('aggregateRating' in schema), 'no fabricated rating');
      assert.ok(!('review' in schema), 'no fabricated reviews');
    }
  }
});

test('breadcrumb runs Home → Examples → title with sequential positions', () => {
  const example = EXAMPLES[0];
  const crumb = exampleBreadcrumb(example, 'en', 'Home', 'Examples');
  assert.equal(crumb['@type'], 'BreadcrumbList');
  assert.deepEqual(
    crumb.itemListElement.map((i) => i.position),
    [1, 2, 3],
  );
  assert.equal(crumb.itemListElement.at(-1)?.name, exampleContent(example, 'en').title);
});

test('hub ItemList lists every example once, in order', () => {
  const list = examplesItemList('en');
  assert.equal(list['@type'], 'ItemList');
  assert.equal(list.itemListElement.length, EXAMPLES.length);
  list.itemListElement.forEach((item, i) => {
    assert.equal(item.position, i + 1);
    assert.ok(item.url.includes(`/examples/${EXAMPLES[i].slug}`));
  });
});
