import assert from 'node:assert/strict';
import { test } from 'node:test';

import { addBillingPeriod } from './subscription-service';

test('addBillingPeriod: monthly subscription expires next month at the same UTC time', () => {
  const start = new Date('2026-06-04T10:30:15.000Z');

  assert.equal(
    addBillingPeriod(start, 'monthly').toISOString(),
    '2026-07-04T10:30:15.000Z',
  );
});

test('addBillingPeriod: monthly subscription clamps to target month end when needed', () => {
  const start = new Date('2026-01-31T08:00:00.000Z');

  assert.equal(
    addBillingPeriod(start, 'monthly').toISOString(),
    '2026-02-28T08:00:00.000Z',
  );
});

test('addBillingPeriod: yearly subscription expires next year at the same UTC time', () => {
  const start = new Date('2024-02-29T08:00:00.000Z');

  assert.equal(
    addBillingPeriod(start, 'yearly').toISOString(),
    '2025-02-28T08:00:00.000Z',
  );
});
