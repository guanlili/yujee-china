import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OVERLAYS } from '@/messages/overlay';
import { boundPick, pick } from './pick';

const PAIR = { zh: '导出 PDF', en: 'Export PDF' };

test('pick reads the pair directly for the two source languages', () => {
  assert.equal(pick('zh', PAIR), '导出 PDF');
  assert.equal(pick('en', PAIR), 'Export PDF');
});

test('pick falls back to English when an overlay has no entry', () => {
  // S-phase overlays are empty; a miss must degrade to English, never to Chinese
  // and never to an empty string.
  for (const locale of ['es', 'ja', 'fr'] as const) {
    assert.equal(pick(locale, PAIR), 'Export PDF');
  }
});

test('pick uses the overlay entry keyed by the English source string', () => {
  const es = OVERLAYS.es!;
  es['Export PDF'] = 'Exportar PDF';
  try {
    assert.equal(pick('es', PAIR), 'Exportar PDF');
    // Other locales are unaffected by one locale's overlay.
    assert.equal(pick('ja', PAIR), 'Export PDF');
    assert.equal(pick('zh', PAIR), '导出 PDF');
  } finally {
    delete es['Export PDF'];
  }
});

test('boundPick binds a locale once and takes the pair positionally', () => {
  const aT = boundPick('zh');
  assert.equal(aT('导出 PDF', 'Export PDF'), '导出 PDF');
  assert.equal(boundPick('fr')('导出 PDF', 'Export PDF'), 'Export PDF');
});
