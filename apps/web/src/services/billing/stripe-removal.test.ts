import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

test('Stripe payment implementation is removed from the web app', () => {
  const packageJson = JSON.parse(read('package.json'));
  assert.equal(packageJson.dependencies?.stripe, undefined);

  assert.equal(existsSync(join(root, 'src/services/billing/stripe-service.ts')), false);
  assert.equal(existsSync(join(root, 'src/app/api/webhooks/stripe/route.ts')), false);

  assert.doesNotMatch(read('src/app/api/v1/billing/checkout/route.ts'), /stripe/i);
  assert.doesNotMatch(read('src/lib/env.ts'), /STRIPE_/);
});
