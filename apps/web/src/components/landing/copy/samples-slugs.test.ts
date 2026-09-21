import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { EXAMPLE_SLUGS } from '@/lib/examples/examples';

// The copy files are JSX and tsx emits the classic transform, so React has to
// be in scope before they load — same arrangement as lib/seo/seo.test.ts. The
// import is dynamic for that reason: a static one would be hoisted above the
// assignment.
(globalThis as unknown as { React: typeof React }).React = React;
const { LANDING_COPIES } = await import('./index');

// The homepage sample grid and the hero strip both send readers to
// /examples/<slug>. A slug typed into a copy file that no example answers to is
// a 404 on the one page most visitors ever see — and a source-regex test would
// not catch it, so this one imports the real data on both sides.
test('every landing sample card points at a real /examples page, in every locale', () => {
  const known = new Set(EXAMPLE_SLUGS);
  for (const [locale, copy] of Object.entries(LANDING_COPIES)) {
    const slugs = copy.samples.map((s) => s.slug);
    assert.equal(new Set(slugs).size, slugs.length, `${locale}: a sample slug repeats`);
    for (const slug of slugs) {
      assert.ok(known.has(slug), `${locale}: sample "${slug}" has no /examples/${slug} page`);
    }
  }
});

test('the six formats on the homepage are exactly the six /examples pages', () => {
  // Every locale carries the same six cards in the same order; the card set is
  // the example set, so a format added in one place but not the other fails here.
  const en = LANDING_COPIES.en.samples.map((s) => s.slug);
  assert.deepEqual([...en].sort(), [...EXAMPLE_SLUGS].sort(), 'cards and examples drifted apart');
  for (const [locale, copy] of Object.entries(LANDING_COPIES)) {
    assert.deepEqual(copy.samples.map((s) => s.slug), en, `${locale} card order differs from en`);
  }
});

test('the strip copy exists in every locale and is not a leftover English placeholder', () => {
  for (const [locale, copy] of Object.entries(LANDING_COPIES)) {
    assert.ok(copy.heroSamplesTitle.trim().length > 0, `${locale}: heroSamplesTitle is empty`);
    assert.ok(copy.heroSamplesMore.trim().length > 0, `${locale}: heroSamplesMore is empty`);
    if (locale !== 'en') {
      assert.notEqual(copy.heroSamplesTitle, LANDING_COPIES.en.heroSamplesTitle, `${locale}: strip title still English`);
    }
  }
});
