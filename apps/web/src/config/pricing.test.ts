import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ACTIVE_CHECKOUT_PROVIDER,
  ADDON_PACKS,
  CHECKOUT_PROVIDERS,
  CREDIT_COST_PER_ALBUM,
  FREE_PLAN_CREDITS,
  PLANS,
  buildCheckoutReturnUrls,
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

test('subscription plans are removed — only the free plan remains', () => {
  assert.deepEqual(
    PLANS.map((p) => p.id),
    ['free'],
  );
});
