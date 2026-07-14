import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ACTIVE_CHECKOUT_PROVIDER,
  ADDON_PACKS,
  CHECKOUT_PROVIDERS,
  CREDIT_COST_PER_ALBUM,
  FREE_PLAN_CREDITS,
  MAX_PHOTOS_PER_GENERATION,
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

test('per-book billing: one book per album, one free welcome book, packs grant whole books', () => {
  assert.equal(CREDIT_COST_PER_ALBUM, 1);
  assert.equal(FREE_PLAN_CREDITS, 1);

  // Pack ids + prices are fixed Creem products; only the granted book count changed.
  assert.deepEqual(
    ADDON_PACKS.map((p) => ({ id: p.id, priceUsd: p.priceUsd, books: p.books })),
    [
      { id: 'pack-2400', priceUsd: 3, books: 1 },
      { id: 'pack-4800', priceUsd: 6, books: 2 },
      { id: 'pack-8000', priceUsd: 10, books: 4 },
      { id: 'pack-16000', priceUsd: 18, books: 8 },
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
      messages.pricing.creditRule,
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
