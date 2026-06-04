import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { getMarketingMessages } from '@/messages/marketing';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, '..', '..', '..');

const covers = [
  '/samples/layouts/graduation.webp',
  '/samples/layouts/wedding.webp',
  '/samples/layouts/baby-milestones.webp',
  '/samples/layouts/travel-memoir.webp',
  '/samples/layouts/girls-trip.webp',
  '/samples/layouts/pet-diary.webp',
  '/samples/layouts/life-memories.webp',
  '/samples/layouts/food-notes.webp',
  '/samples/layouts/love-diary.webp',
];

test('inspiration marquee uses the supplied public cover assets', () => {
  const source = readFileSync(join(here, 'InspirationMarquee.tsx'), 'utf8');

  assert.equal(getMarketingMessages('en').landing.cases.length, covers.length);
  assert.equal(getMarketingMessages('zh').landing.cases.length, covers.length);
  assert.doesNotMatch(source, /linear-gradient\(135deg/, 'sample covers should not fall back to placeholder gradients');

  for (const cover of covers) {
    assert.match(source, new RegExp(cover.replaceAll('/', '\\/')), `${cover} should be referenced by the marquee`);
    const file = join(webRoot, 'public', cover);
    assert.equal(existsSync(file), true, `${cover} should exist in public assets`);
    assert.ok(statSync(file).size < 180_000, `${cover} should stay lightweight for the homepage`);
  }
});
