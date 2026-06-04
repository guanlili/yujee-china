import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ACTIVE_CHECKOUT_PROVIDER,
  CHECKOUT_PROVIDERS,
  buildCheckoutReturnUrls,
  buildSubscriptionReturnUrls,
} from './pricing';

test('credit checkout can explicitly route through Creem or Stripe', () => {
  assert.equal(ACTIVE_CHECKOUT_PROVIDER, 'creem');
  assert.deepEqual(CHECKOUT_PROVIDERS, ['creem', 'stripe']);

  const urls = buildCheckoutReturnUrls(
    'https://app.yujee.test',
    'stripe',
    { locale: 'en', from: 'create' },
  );

  assert.equal(
    urls.successUrl,
    'https://app.yujee.test/en/credits?checkout=success&provider=stripe&from=create',
  );
});

test('subscription checkout returns to localized pricing with provider context', () => {
  const urls = buildSubscriptionReturnUrls(
    'https://app.yujee.test',
    'creem',
    { locale: 'zh' },
  );

  assert.equal(
    urls.successUrl,
    'https://app.yujee.test/zh/pricing?checkout=success&kind=subscription&provider=creem',
  );
  assert.equal(
    urls.cancelUrl,
    'https://app.yujee.test/zh/pricing?checkout=cancel&kind=subscription&provider=creem',
  );
});
