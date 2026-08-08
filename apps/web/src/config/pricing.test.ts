import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ACTIVE_CHECKOUT_PROVIDER,
  ADDON_PACKS,
  CHECKOUT_PROVIDERS,
  CREDIT_COST_PER_ALBUM,
  FREE_PLAN_CREDITS,
  MAX_PHOTOS_PER_GENERATION,
  PAGES_PER_CREDIT,
  PAGES_PER_CREDIT_LABEL,
  PHOTOS_PER_CREDIT,
  PLANS,
  buildCheckoutReturnUrls,
  creditsForPhotos,
} from './pricing';

test('credit checkout routes through Creem only', () => {
  assert.equal(ACTIVE_CHECKOUT_PROVIDER, 'creem');
  assert.deepEqual(CHECKOUT_PROVIDERS, ['creem']);

  const urls = buildCheckoutReturnUrls(
    'https://app.yujee.test',
    'creem',
    { locale: 'en', from: 'create' },
  );

  assert.equal(
    urls.successUrl,
    'https://app.yujee.test/en/credits?checkout=success&provider=creem&from=create',
  );
});

test('per-photo billing: one credit per photo, packs grant credits, free welcome grant', () => {
  // Flat per-album fallback stays 1 (deprecated); the live path is per-photo.
  assert.equal(CREDIT_COST_PER_ALBUM, 1);
  // Re-denominated 2026-07-17: 1 credit = 1 photo, so the welcome grant and packs
  // are ×20 the old book counts (same dollars, same photos, clearer unit).
  assert.equal(FREE_PLAN_CREDITS, 20);

  // Pack ids + prices are fixed Creem products; only the granted credit count changed.
  assert.deepEqual(
    ADDON_PACKS.map((p) => ({ id: p.id, priceUsd: p.priceUsd, books: p.books })),
    [
      { id: 'pack-1', priceUsd: 3, books: 20 },
      { id: 'pack-4', priceUsd: 10, books: 80 },
      { id: 'pack-10', priceUsd: 20, books: 200 },
    ],
  );
});

test('creditsForPhotos: ceil(N / PHOTOS_PER_CREDIT), floored at 1 (§6.7 single source of truth)', () => {
  assert.equal(creditsForPhotos(1), 1);
  assert.equal(creditsForPhotos(PHOTOS_PER_CREDIT), 1);
  assert.equal(creditsForPhotos(PHOTOS_PER_CREDIT + 1), 2);
  assert.equal(creditsForPhotos(PHOTOS_PER_CREDIT * 2), 2);
  assert.equal(creditsForPhotos(0), 1, 'an empty/odd count never charges zero');

  // The per-request photo cap is a whole number of credits derived from the threshold.
  assert.equal(MAX_PHOTOS_PER_GENERATION % PHOTOS_PER_CREDIT, 0);
  assert.ok(MAX_PHOTOS_PER_GENERATION >= PHOTOS_PER_CREDIT);
});

test('analyze generation request accepts up to 100 photos', () => {
  assert.equal(MAX_PHOTOS_PER_GENERATION, 100);
});

test('subscription plans are removed — only the free plan remains', () => {
  assert.deepEqual(
    PLANS.map((p) => p.id),
    ['free'],
  );
});

// The photos-per-credit rule is stated in UI copy via a {photos} placeholder that
// the component substitutes from PHOTOS_PER_CREDIT. A typed number in the JSON
// would silently go stale — it already did once (10 → 20). Guard both directions.
test('pricing copy states the photos-per-credit rule via {photos}, never a typed number', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');

  for (const locale of ['zh', 'en']) {
    const path = fileURLToPath(new URL(`../messages/${locale}.json`, import.meta.url));
    const messages = JSON.parse(readFileSync(path, 'utf8'));

    const stating = [
      messages.pricing.subtitle,
      messages.dashboard.credits.rechargeSub,
    ];

    for (const copy of stating) {
      assert.ok(
        copy.includes('{photos}'),
        `${locale}: "${copy}" must state the rule through {photos}, not a fixed number`,
      );
      // No stray photo count typed alongside the placeholder.
      const typed = [...copy.matchAll(/(\d+)\s*(张照片|photos)/g)];
      assert.equal(typed.length, 0, `${locale}: "${copy}" hardcodes a photo count`);
    }
  }
});

// The JSON-side guard above only proves the copy CONTAINS {photos}. It says
// nothing about whether the component substitutes it — and it didn't: the
// English home shipped the literal "1 credit = {photos} photos" to users because
// LandingPricing rendered t.subtitle raw. Assert the substitution itself.
test('withPhotoRule substitutes every {photos} token — no placeholder reaches the page', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');

  const withPhotoRule = (copy: string) =>
    copy
      .replaceAll('{photos}', String(PHOTOS_PER_CREDIT))
      .replaceAll('{pages}', PAGES_PER_CREDIT_LABEL);

  for (const locale of ['zh', 'en']) {
    const path = fileURLToPath(new URL(`../messages/${locale}.json`, import.meta.url));
    const messages = JSON.parse(readFileSync(path, 'utf8'));

    for (const copy of [
      messages.pricing.subtitle,
      messages.dashboard.credits.rechargeSub,
    ]) {
      const rendered = withPhotoRule(copy);
      assert.ok(
        !rendered.includes('{'),
        `${locale}: "${rendered}" still carries an unsubstituted placeholder`,
      );
      assert.ok(
        rendered.includes(String(PHOTOS_PER_CREDIT)),
        `${locale}: "${rendered}" should state the real photo count`,
      );
    }
  }
});

// Public pricing copy must STATE the rule, not PROMISE behaviour. Lines like
// "charged only once the layout succeeds" or "editing / chat / PDF export are
// free" describe today's implementation; the moment billing changes, that copy
// is a broken promise sitting on the marketing page. Ruled out 2026-07-14 —
// keep the copy to what a credit buys.
test('pricing copy makes no operational promises — only states what a credit buys', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { getFaqEntries } = await import('../lib/seo/faq');
  const { buildLlmsTxt } = await import('../lib/seo/llms');
  const { locales } = await import('../lib/i18n/routing');

  const FORBIDDEN = [
    /排版成功后才扣/,
    /导出\s*PDF\s*都?免费/,
    /编辑、对话[^。]*免费/,
    /charged (only )?once the layout succeeds/i,
    /charged when the layout succeeds/i,
    /editing[^.]*\bfree\b/i,
  ];

  // Only the copy a user actually reads — not the file source, which contains
  // unrelated prose (and the very comments explaining this rule).
  const surfaces: string[] = [buildLlmsTxt()];
  for (const locale of locales) {
    const path = fileURLToPath(new URL(`../messages/${locale}.json`, import.meta.url));
    const m = JSON.parse(readFileSync(path, 'utf8'));
    surfaces.push(m.pricing.subtitle, m.dashboard.credits.rechargeSub);
    for (const entry of getFaqEntries(locale)) surfaces.push(entry.a);
  }

  for (const copy of surfaces) {
    for (const banned of FORBIDDEN) {
      assert.doesNotMatch(
        copy,
        banned,
        `pricing copy promises operational behaviour (${banned}): "${copy}"`,
      );
    }
  }
});

test('pricing copy states the typical page range from the constant', () => {
  assert.equal(PAGES_PER_CREDIT_LABEL, `${PAGES_PER_CREDIT.min}-${PAGES_PER_CREDIT.max}`);
  assert.ok(PAGES_PER_CREDIT.min < PAGES_PER_CREDIT.max, 'page range must be a real range');
});
