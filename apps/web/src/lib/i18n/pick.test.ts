import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OVERLAYS } from '@/messages/overlay';
import { boundPick, pick } from './pick';

// A synthetic pair keeps these tests independent of shipped overlay content —
// real copy like "Export PDF" is translated in every overlay, so asserting
// fallback against it would break the moment a translator covers it.
const PAIR = { zh: '合成中文文案', en: 'synthetic-pick-test-string' };

test('pick reads the pair directly for the two source languages', () => {
  assert.equal(pick('zh', PAIR), '合成中文文案');
  assert.equal(pick('en', PAIR), 'synthetic-pick-test-string');
});

test('pick falls back to English when an overlay has no entry', () => {
  // A miss must degrade to English, never to Chinese and never to an empty string.
  for (const locale of ['es', 'ja', 'fr'] as const) {
    assert.equal(pick(locale, PAIR), 'synthetic-pick-test-string');
  }
});

test('pick uses the overlay entry keyed by the English source string', () => {
  const es = OVERLAYS.es!;
  es[PAIR.en] = 'cadena sintética';
  try {
    assert.equal(pick('es', PAIR), 'cadena sintética');
    // Other locales are unaffected by one locale's overlay.
    assert.equal(pick('ja', PAIR), 'synthetic-pick-test-string');
    assert.equal(pick('zh', PAIR), '合成中文文案');
  } finally {
    delete es[PAIR.en];
  }
});

test('pick resolves shipped overlay content for every added locale', () => {
  // One real key, asserted against the tables themselves: every overlay must
  // cover it with a non-empty, non-English value.
  const real = { zh: '导出 PDF', en: 'Export PDF' };
  for (const locale of ['es', 'ja', 'fr'] as const) {
    const got = pick(locale, real);
    assert.equal(got, OVERLAYS[locale]![real.en]);
    assert.ok(got.trim().length > 0);
    assert.notEqual(got, real.en);
  }
});

test('boundPick binds a locale once and takes the pair positionally', () => {
  const aT = boundPick('zh');
  assert.equal(aT('合成中文文案', 'synthetic-pick-test-string'), '合成中文文案');
  assert.equal(boundPick('fr')('合成中文文案', 'synthetic-pick-test-string'), 'synthetic-pick-test-string');
});
