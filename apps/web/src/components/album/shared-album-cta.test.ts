import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { buildSpreads } from './spreads';
import { boundPick } from '@/lib/i18n/pick';
import { locales } from '@/lib/i18n/routing';
import { isLastSpread, shareCta } from './shared-album-cta';
import type { EditorPage } from './types';

const here = dirname(fileURLToPath(import.meta.url));
const shared = readFileSync(join(here, 'SharedAlbum.tsx'), 'utf8');

// The share page is the only surface where a stranger meets a finished book, and
// it currently dead-ends: noindex (correct — these are private memoirs) and no
// way back to Yujee. The logo and the end-of-book CTA are the whole distribution
// loop, so they get pinned.

// REAL template ids: pageSlot resolves the category through getTemplate, so a
// made-up id like 'cover' silently falls through to 'interior' and the test
// passes while exercising none of the cover/ending solo-spread logic.
const COVER = 'mag-01';
const INTERIOR = 'mag-03';
const ENDING = 'mag-20';

function page(templateId: string, i: number): EditorPage {
  return { id: `p${i}`, index: i, templateId, images: [], texts: {}, html: '' } as unknown as EditorPage;
}

test('the fixture template ids really do carry the categories this test relies on', () => {
  // Guard for the guard: if these ids are ever recategorised, the tests below
  // would quietly stop testing solo spreads. Fail loudly instead.
  const solo = buildSpreads([page(COVER, 0), page(ENDING, 1)]);
  assert.equal(solo.length, 2, 'cover and ending must each own a spread — fixture ids are wrong');
});

test('isLastSpread fires on the closing spread, not merely the last array index', () => {
  // Interior pages pair two-up, so "the reader reached the end" is a property of
  // the SPREAD, not of the page index.
  const pages = [page(COVER, 0), page(INTERIOR, 1), page(INTERIOR, 2), page(ENDING, 3)];
  const spreads = buildSpreads(pages);

  assert.equal(isLastSpread(spreads, 0), false, 'the cover is not the end');
  assert.equal(isLastSpread(spreads, 1), false, 'an interior spread is not the end');
  assert.equal(isLastSpread(spreads, 2), false, 'an interior spread is not the end');
  assert.equal(isLastSpread(spreads, 3), true, 'the ending page is the end');
});

test('isLastSpread treats both halves of a closing pair as the end', () => {
  // A book with no dedicated ending page finishes on a pair. A reader parked on
  // its LEFT half has still reached the end — the naive index check misses this.
  const pages = [page(COVER, 0), page(INTERIOR, 1), page(INTERIOR, 2)];
  const spreads = buildSpreads(pages);
  const closing = spreads[spreads.length - 1];
  assert.equal(closing.kind, 'pair', 'this fixture is meant to close on a pair');
  assert.ok(closing.left !== null && closing.right !== null, 'the closing pair should be full');

  assert.equal(isLastSpread(spreads, closing.left), true, 'left half of the closing pair is the end');
  assert.equal(isLastSpread(spreads, closing.right), true, 'right half of the closing pair is the end');
  assert.equal(isLastSpread(spreads, 0), false, 'the cover is still not the end');
});

test('isLastSpread never throws on an unknown or empty book', () => {
  assert.equal(isLastSpread([], 0), false);
  assert.equal(isLastSpread(buildSpreads([page('cover', 0)]), 99), false);
});

test('the CTA resolves in every shipped locale and never hard-sells a price', () => {
  // Five locales ship, not two. A private 'en' | 'zh' table would have handed
  // Chinese to every es/ja/fr reader, so this walks the real locale list.
  assert.ok(locales.length >= 5, 'locale list shrank — re-check the CTA overlay coverage');

  for (const locale of locales) {
    const c = shareCta(boundPick(locale));
    for (const [key, value] of Object.entries(c)) {
      assert.ok(value.length > 0, `${locale}.${key} is empty`);
    }
    // A stranger who just read someone's memoir is the worst possible audience
    // for a price tag. The ask is "make one", not "buy one".
    assert.doesNotMatch(
      `${c.title} ${c.body} ${c.primary}`,
      /\$|\d+\s*(credits?|积分)|¥/,
      `${locale} CTA quotes a price`,
    );
  }

  // A non-Chinese locale must never fall through to the Chinese string — that is
  // the exact failure the pick/overlay pipeline exists to prevent. (ja is CJK by
  // nature, so it is checked for kana instead, below.)
  for (const locale of locales.filter((l) => l !== 'zh' && l !== 'ja')) {
    const c = shareCta(boundPick(locale));
    assert.doesNotMatch(c.primary, /[一-鿿]/, `${locale} CTA fell back to Chinese`);
  }
});

test('es/ja/fr have real overlay entries, not the English fallback', () => {
  // pick() degrades to English on a miss, which is correct behaviour and also
  // completely silent — a new surface can ship "translated" while three of five
  // locales read English. Compare against English to prove the entries exist.
  const en = shareCta(boundPick('en'));
  for (const locale of ['es', 'ja', 'fr'] as const) {
    const c = shareCta(boundPick(locale));
    for (const key of ['title', 'body', 'primary', 'secondary', 'copied', 'dismiss'] as const) {
      assert.notEqual(c[key], en[key], `${locale}.${key} is still the English fallback`);
    }
  }
  // Japanese should read as Japanese, not as pasted Chinese.
  assert.match(shareCta(boundPick('ja')).dismiss, /[ぁ-んァ-ン]/, 'ja CTA has no kana — likely Chinese text');
});

test('the primary CTA lands on the composer, not a signup wall', () => {
  // Guest mode means a visitor can go from landing composer all the way to an
  // exported book without an account. Routing this CTA to /register would put a
  // wall in front of the one moment the visitor is most persuaded.
  assert.match(shared, /#homepage-composer/, 'the CTA no longer targets the landing composer');
  assert.doesNotMatch(shared, /\/register|\/login/, 'the share CTA must not send strangers to auth');
});

test('arbitrary text utilities on the share page all carry a length:/color: hint', () => {
  // An untyped arbitrary text utility holding a CSS variable compiles to
  // `color:`, so a font-size token emits an invalid colour, which resets colour
  // to `unset` and beats any real colour class earlier in the sheet. That
  // shipped the CTA button as black text on a black pill.
  //
  // The pattern is assembled from fragments on purpose: Tailwind scans this file
  // too, and a literal untyped example anywhere in the repo — comment, test name,
  // assertion message — makes it emit the broken rule and take globals.css down
  // with a CSS parse error. Writing the example out cost the whole app a 500.
  const untyped = new RegExp(['text', '\\[var\\(--[a-z-]+\\)\\]'].join('-'), 'g');
  const bare = [...shared.matchAll(untyped)].map((m) => m[0]);
  assert.deepEqual(bare, [], `untyped arbitrary text utility found — add length: or color: — ${bare.join(', ')}`);
});

test('the CTA gets out of the way of the closing page on desktop', () => {
  // Bottom-docked, the card covered the very page the reader is reacting to.
  assert.match(shared, /sm:items-center/, 'the desktop CTA is no longer centred');
  assert.match(shared, /sm:backdrop-blur/, 'the desktop CTA lost its backdrop blur');
  // Mobile deliberately keeps the bottom sheet and stays click-through.
  assert.match(shared, /pointer-events-none/, 'the mobile overlay must stay click-through');
  assert.match(shared, /items-end/, 'mobile should still dock the card to the bottom');
});

test('the share page carries the Yujee logo, linked home', () => {
  assert.match(shared, /logo-yujee\.svg/, 'the share header lost the logo');
  assert.match(shared, /<Link/, 'the logo must be a link back to Yujee');
});

test('the share page stays noindex — the CTA is for humans, not crawlers', () => {
  // These are private memoirs. The distribution loop is referral traffic from
  // people who were sent the link, never search indexing.
  const sharePage = readFileSync(join(here, '..', '..', 'app', '[locale]', 's', '[token]', 'page.tsx'), 'utf8');
  assert.match(sharePage, /index:\s*false/, 'share pages must not become indexable');
});
