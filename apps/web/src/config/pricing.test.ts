import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ACTIVE_CHECKOUT_PROVIDER, buildCheckoutReturnUrls } from './pricing';

test('active credit checkout provider is creem only', () => {
  assert.equal(ACTIVE_CHECKOUT_PROVIDER, 'creem');

  const urls = buildCheckoutReturnUrls(
    'https://app.yujee.test',
    ACTIVE_CHECKOUT_PROVIDER,
    { locale: 'en', from: 'create' },
  );

  assert.equal(
    urls.successUrl,
    'https://app.yujee.test/en/credits?checkout=success&provider=creem&from=create',
  );
});
